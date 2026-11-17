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

export interface HqMemberOrgAssignment {
  id: string;
  org_name: string;
  is_primary: boolean;
  is_leader: boolean;
  title: string;
}

export interface HqProfileExtra {
  nickname?: string;
  bio?: string;
  personal_email?: string;
  group_hire_date?: string;
  hire_type?: string;
  hr_effective_date?: string;
  hr_appointment_label?: string;
  hr_appointment_memo?: string;
  hr_jobs_selected?: string[];
  hr_job_group?: string;
  hr_position?: string;
  hr_grade?: string;
  org_assignments?: HqMemberOrgAssignment[];
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
  workflow_meta?: HqWorkflowDocMeta | null;
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

export interface HqAnnualLeavePolicyItem {
  id: string;
  policy_id: string; // approval_policies 내 'lv-annual' 등 매칭
  name: string; // 예: "기본 연차 정책"
  description: string;
  is_default?: boolean;
  // 기본 설정
  request_on_register: boolean; // 휴가를 등록할 때 승인/참조 요청
  request_on_cancel: boolean; // 등록한 휴가를 취소할 때 승인 요청
  usage_unit_category: "시간" | "반차" | "일";
  hourly_sub_unit:
    | "1분"
    | "5분"
    | "10분"
    | "15분"
    | "20분"
    | "30분"
    | "1시간"
    | "2시간";
  advance_use_enabled: boolean; // 당겨쓰기 허용
  advance_use_mode: "자유롭게 사용 가능" | "사용량 제한";
  advance_use_limit_days?: number; // 사용량 제한 시 최대 일수
  // 연차 부여 방식
  accrual_basis: "회계일" | "입사일";
  fiscal_month_day: string; // 예: "1월 1일"
  effective_start_date: string; // 예: "2021-01-01"
  first_year_monthly_rule:
    | "매월 개근시 1일 부여"
    | "입사 시 11일 선부여"
    | "부여 안 함";
  first_year_annual_rule:
    | "첫 회계일에 근무한 기간의 연차 부여"
    | "1년 만근시 15일 부여";
  decimal_rounding:
    | "일 단위 올림 처리"
    | "0.5일 단위 올림 처리"
    | "시간 단위로 비례 부여"
    | "소수점 둘째 자리 반올림";
  extra_bonus_days: number; // 법정 외 추가 부여 일수 (기본 0)
  use_group_hire_date: boolean; // 그룹 입사일 기준 여부
  // 자동 소멸 설정 (연말 일괄 소멸 / 유예 / 소멸 안 함 모두 선택 가능)
  monthly_expire_point:
    | "입사일로부터 1년 후"
    | "당해 연말 (매년 12월 31일)"
    | "첫 회계일 후 1년"
    | "소멸 안 함";
  monthly_grace_period: string; // "유예기간 없음" | "1개월" .. "24개월"
  annual_expire_point:
    | "부여일로부터 1년 후"
    | "당해 연말 (매년 12월 31일)"
    | "소멸 안 함";
  annual_grace_period: string; // "유예기간 없음" | "1개월" .. "24개월"
  // 스마트 연차 촉진
  smart_promotion_enabled: boolean;
  // 적용 구성원
  apply_all_default?: boolean;
  assigned_members: HqOvertimeAssignedMember[];
}

export interface HqAnnualLeaveGlobalSettings {
  hide_visibility_banner?: boolean;
  retiree_adjustment_rule:
    | "구성원에게 유리한 기준으로 적용"
    | "항상 근로기준법 기준으로 적용";
  // 연차 촉진 설정 (연차 사용 계획 'wf-leave-plan' 연동)
  promotion_remind_member: boolean;
  promotion_remind_admin: boolean;
  promotion_plan_notify_timing: string; // "사용 계획일 10일 전" 등
  smart_annual_timing: string; // "소멸 6개월 전 + 10일 후" 등
  smart_monthly_timing_1st: string; // "소멸 3개월 전"
  smart_monthly_timing_2nd: string; // "소멸 1개월 전"
  policies: HqAnnualLeavePolicyItem[];
}

export type HqCustomLeaveGrantMethod =
  | "신청 시 부여"
  | "연차 소진 시 부여"
  | "관리자가 직접 부여"
  | "입사 시 부여"
  | "반복 부여"
  | "근속 시 부여";

export interface HqCustomLeaveItem {
  id: string;
  policy_id: string; // approval_policies 내 leave 카테고리 id 매칭
  name: string;
  icon: string;
  description: string;
  is_mandatory?: boolean; // '필수' 법정/기본 휴가 배지
  is_reward_type?: boolean; // '보상' 휴가 전용 모달 형태
  grant_method: HqCustomLeaveGrantMethod;
  repeat_cycle?: string; // "입사 월부터 매월" | "매월 1일 부여" | "매년 1월 1일 부여" | "입사일 기준 매년"
  repeat_use_group_hire?: boolean;
  tenure_years_rule?: string; // 근속 시 부여 기준 (예: "만 3년 · 5년 · 10년 근속 시")
  grant_unit: "일 단위 부여" | "시간 단위 부여" | "분 단위 부여";
  grant_amount: number; // 예: 보건 1, 산전후 본인 90, 다태아 120, 배우자출산 10, 결혼 5, 조의 3/2
  usage_unit:
    | "한번에 모두 사용"
    | "일 단위 사용"
    | "반차 단위 사용"
    | "시간차 사용 (30분 단위)"
    | "시간차 사용 (1시간 단위)"
    | "시간차 사용 (제한없음)";
  pay_type: "유급" | "무급" | "일부 유급";
  partial_paid_days?: number; // 일부 유급일 때 유급 일수 (예: 산전후 본인 60일, 다태아 75일)
  request_on_register: boolean;
  request_on_cancel: boolean;
  allow_advance_register?: boolean; // 보상 휴가: 휴가 사전 등록 가능
  // 추가 설정
  target_gender: "모두" | "여성" | "남성";
  proof_document_mode: "없음" | "사전 제출" | "사후 제출" | "선택 제출";
  proof_document_guide?: string;
  deduct_on_holidays: boolean; // 휴일에 등록된 휴가 차감
  apply_to_existing_granted?: boolean; // 기존 부여된 휴가에도 반영하기
}

export type HqPayrollRoundingMode = "올림" | "반올림" | "버림";

export interface HqPayrollPayItem {
  id: string;
  section: "FIXED" | "HOURLY" | "VARIABLE";
  code?: string; // 예: "A001", "A002", "A003", "H001"
  name: string;
  icon: string;
  description: string;
  tip_text?: string;
  is_system_default?: boolean; // '기본' 배지 (삭제 불가)
  is_monthly_every: boolean; // 매월 지급 여부
  selected_months?: number[]; // 매월 지급이 아닐 때 선택 월(1~12)
  amount_mode: "PER_PERSON" | "UNIFORM" | "SETTLEMENT_INPUT";
  uniform_amount?: number; // 모두에게 동일 지급할 금액
  include_in_annual_salary: boolean; // 연봉포함 여부
  is_tax_free: boolean; // 비과세 여부
  taxable_category: string; // 과세 시 유형 (예: "급여", "기타수당", "초과근무수당", "기타상여금")
  non_taxable_code?: string; // 비과세 시 코드 (예: "P01", "H03", "H10", "Q02")
  include_in_ordinary_wage: boolean; // 통상임금 포함 여부
  include_in_average_wage: boolean; // 평균임금 포함 여부
  prorate_policy: string; // 예: "입사·휴직·퇴직원 모두 일할 지급"
  // 주휴수당 전용 주중 일부 근무 정책
  hire_week_policy?: "전액 지급" | "근무일에 비례하여 지급" | "지급하지 않음";
  leave_week_policy?: "전액 지급" | "근무일에 비례하여 지급" | "지급하지 않음";
  resign_week_policy?: "전액 지급" | "근무일에 비례하여 지급" | "지급하지 않음";
  unit_precision: string; // "100의 단위" | "10의 단위" | "1의 단위" | "소수점 첫째 자리"
  rounding_mode: HqPayrollRoundingMode;
  payslip_note: string; // 급여명세서 표기란
}

export interface HqPayrollDeductionItem {
  id: string;
  name: string;
  description: string;
  deduction_type: string; // "기타" | "국민연금" | "건강보험" ... (15종)
  cycle_mode: "매 월" | "직접 선택";
  selected_months?: number[];
  target_scope:
    | "대상자 전체"
    | "대상자 선택"
    | "대상자 조건 설정"
    | "정산할 때 대상자 선택";
  selected_member_names?: string[];
  target_departments?: string[];
  amount_mode: "정산 시 입력" | "금액 일괄 설정" | "대상자별로 다른 금액 설정";
  uniform_amount?: number;
  payslip_note: string;
}

export interface HqWithholdingAgentInfo {
  is_configured: boolean;
  submitter_type: "법인" | "개인";
  business_reg_no: string;
  // 법인 전용
  corp_name: string;
  corp_type: string;
  ceo_name: string;
  corp_reg_no: string;
  // 개인 전용
  trade_name: string;
  owner_name: string;
  resident_reg_no: string;
  // 공통
  location_address: string;
  tax_office: string;
  hometax_id: string;
  english_info_enabled: boolean;
  english_corp_name?: string;
  english_ceo_name?: string;
  english_address?: string;
  unit_taxpayer_enabled: boolean; // 사업자 단위 과세자
  sub_business_seq_no?: string; // 종사업장 일련번호 (4자리)
}

export interface HqSeveranceCalcSettings {
  avg_wage_period: "3개월" | "90일";
  calc_basis: "높은 금액 적용" | "평균임금" | "통상임금";
  severance_unit: string;
  severance_rounding: HqPayrollRoundingMode;
  avg_wage_unit: string;
  avg_wage_rounding: HqPayrollRoundingMode;
  avg_wage_first_decimal_rounding: HqPayrollRoundingMode;
  ordinary_wage_unit: string;
  ordinary_wage_rounding: HqPayrollRoundingMode;
}

export interface HqPayslipBasisSettings {
  // 1) 기본근무 산출근거
  base_work_enabled: boolean;
  base_work_days: boolean;
  base_standard_days: boolean;
  base_standard_days_desc: boolean;
  base_ordinary_hourly: boolean;
  base_hours_and_hourly: boolean;
  base_hours_desc: boolean;
  base_shortage_hours: boolean;
  base_unpaid_leave_hours: boolean;
  // 2) 주휴수당 산출근거
  weekly_holiday_enabled: boolean;
  weekly_holiday_period: boolean;
  weekly_holiday_hours: boolean;
  weekly_holiday_hourly: boolean;
  // 3) 고정초과근무 산출근거
  fixed_ot_enabled: boolean;
  fixed_ot_contract_hours: boolean;
  fixed_ot_hourly: boolean;
  fixed_ot_amount: boolean;
  // 4) 초과근무 산출근거
  variable_ot_enabled: boolean;
  variable_ot_9types: boolean;
  variable_ot_hourly: boolean;
  // 5) 재직자 연차수당 산출근거
  active_leave_pay_enabled: boolean;
  active_leave_unused_days: boolean;
  active_leave_daily_hours: boolean;
  active_leave_hourly: boolean;
  // 6) 퇴직자 연차수당 산출근거
  retiree_leave_pay_enabled: boolean;
  retiree_leave_unused_days: boolean;
  retiree_leave_daily_hours: boolean;
  retiree_leave_hourly: boolean;
}

export interface HqPayrollCertificateItem {
  id: string;
  name: string;
  cert_type: "법인" | "개인";
  file_name: string;
  registered_at: string;
}

export interface HqPayrollTaxWorkplaceItem {
  id: string;
  name: string;
  business_reg_no: string;
  sub_business_seq_no?: string;
  local_gov_name: string; // 특별징수 관할 시·군·구청 (예: 서울특별시 송파구청)
  address: string;
  is_primary: boolean;
}

export interface HqPayrollSettings {
  auto_fill_meal_allowance: boolean;
  auto_fill_meal_amount: number;
  pay_items: HqPayrollPayItem[];
  deduction_items: HqPayrollDeductionItem[];
  withholding_agent: HqWithholdingAgentInfo;
  social_insurance_mgmt_no: string;
  social_insurance_phone: string;
  company_size_tier:
    | "150인 미만 기업"
    | "150인 이상 우선지원 대상기업"
    | "150인 이상 ~ 1000인 미만 기업"
    | "1000인 이상 기업 및 국가, 지방단체가 직접 행하는 사업";
  severance_calc: HqSeveranceCalcSettings;
  payslip_basis: HqPayslipBasisSettings;
  exclude_emp_ins_on_mid_settlement: boolean;
  deduction_decimal_rounding: HqPayrollRoundingMode;
  withholding_ledger_month_rule:
    | "귀속연월"
    | "마지막 지급연월 기준 표기"
    | "지급연월별 분리 표기";
  certificates: HqPayrollCertificateItem[];
  tax_workplaces: HqPayrollTaxWorkplaceItem[];
}

export interface HqRetireeDocSettingItem {
  id: string;
  policy_id?: string; // approval_policies 내 retiree_doc 카테고리 id 매칭 (급여명세서 제외 6종)
  title: string;
  description: string;
  supports_approval: boolean; // 급여명세서는 false, 나머지 6종은 true
  allow_issue: boolean; // 문서 발급 허용 (기본 true)
  issue_period: string; // 예: "퇴직일로부터 5년" | "제한 없음" 등 12종
  use_approval: boolean; // 승인 사용 여부 (기본 false = 즉시 발급)
}

export interface HqAllowedIpEntry {
  id: string;
  label: string; // 예: "본사 사무실 Wi-Fi", "대표 자택"
  ip_or_cidr: string; // 예: "58.149.52.180" 또는 "121.165.204.0/24"
  created_at: string;
}

export interface HqTempAuthCodeEntry {
  id: string;
  member_id: string;
  member_name: string;
  department?: string;
  code: string; // 6자리 임시 인증번호
  expires_at: string;
  created_at: string;
  issued_by: string;
}

export interface HqSecuritySettings {
  // 1) 보안 · 인증 설정 (181845)
  two_factor_enabled: boolean;
  two_factor_exempt_ips: HqAllowedIpEntry[];
  otp_reset_logs: {
    id: string;
    member_name: string;
    reset_by: string;
    reset_at: string;
  }[];
  ip_restriction_enabled: boolean;
  allowed_ips: HqAllowedIpEntry[];
  ip_restriction_scope:
    | "모든 기능 제한"
    | "쓰기·다운로드만 제한"
    | "급여·인사 민감정보만 제한";
  ip_restrict_super_admin: boolean;

  // 2) 로그인 설정 Beta (181906 ~ 181944)
  allow_email_login: boolean;
  allow_phone_login: boolean;
  allow_passkey_login: boolean;
  passkey_max_limit: string; // "1개" ~ "5개"
  login_max_attempts: string; // "3회" | "5회" | "10회"
  pc_auto_logout: string; // "3시간" | "6시간" | "12시간" | "1일" | "3일" | "7일" | "14일"
  mobile_auto_logout: string; // "30일" | "90일" | "180일" | "365일"
  allow_on_leave_login: boolean;
  temp_auth_codes: HqTempAuthCodeEntry[];
}

export type HqAuditActivityType = "개인정보 접근" | "인증" | "권한 변경";
export type HqAuditEventType = "다운로드" | "생성" | "조회" | "수정" | "삭제";

export interface HqAuditLogItem {
  id: string;
  activity_type: HqAuditActivityType;
  user_id?: string;
  user_name: string;
  user_email: string;
  department?: string;
  event_type: HqAuditEventType;
  info_type: string; // "-" | "개인정보" | "가족정보" | "근로소득" | "인사정보" | "근무정보" 등
  description: string;
  delegated: boolean;
  ip_address: string;
  created_at: string;
}

export type HqPermissionScope =
  | "전체 구성원"
  | "하위 조직 포함"
  | "소속 조직";

export interface HqPermissionGroupItem {
  id: string;
  name: string;
  description: string;
  is_system?: boolean; // "SUPER_ADMIN" | "ORG_HEAD" | "DEFAULT_MEMBER" 구분용
  system_kind?: "SUPER_ADMIN" | "ORG_HEAD" | "DEFAULT_MEMBER";
  member_names: string[]; // 그룹에 배정된 구성원 이름 목록 (예: ["천종현", "김근식", "이웅행"])
  permissions: Record<string, boolean>; // permKey -> 허용 여부
  scopes: Record<string, HqPermissionScope>; // 범위 지정형 permKey -> 범위
}

export interface HqPermissionSettings {
  super_admin_names: string[];
  org_head_permissions: Record<string, boolean>;
  org_head_scopes: Record<string, HqPermissionScope>;
  default_member_permissions: Record<string, boolean>;
  groups: HqPermissionGroupItem[];
}

export type HqAccessTerminalProvider = "secom" | "adt_caps" | "kt_telecop";

export interface HqTerminalCardMapping {
  member_id?: string;
  member_name: string;
  department?: string;
  terminal_user_no: string; // 캡스/세콤 카드번호, 지문ID 또는 단말기 사번
}

export interface HqAccessTerminalConfig {
  enabled: boolean;
  terminal_name: string; // 예: "본사 402호 출입문 캡스 리더기"
  contract_no: string; // 고객번호/계약번호 (선택)
  webhook_secret: string; // 실시간 브릿지 웹훅 인증키
  punch_rule: "FIRST_IN_LAST_OUT" | "EXPLICIT_MODE";
  member_mappings: HqTerminalCardMapping[];
  last_synced_at?: string | null;
  last_synced_summary?: string | null;
}

export interface HqGoogleCalendarIntegrationConfig {
  enabled: boolean;
  calendar_id: string; // 비워두면 서버 환경변수 TARGET_CALENDAR_ID 사용
  event_prefix: string; // 예: "[HQ]"
  sync_leaves: boolean; // 연차·반차·맞춤휴가 승인 시 자동 등록
  sync_work_forms: boolean; // 외근·출장·원격근무 승인 시 자동 등록
  sync_company_holidays: boolean; // 회사 지정 쉬는날 일괄 동기화
  last_synced_at?: string | null;
  verified_calendar_title?: string | null;
}

export interface HqSlackIntegrationConfig {
  enabled: boolean;
  webhook_url: string;
  channel_name: string; // 예: "#본사-근태-결재"
  notify_attendance: boolean;
  notify_leave: boolean;
  notify_approval: boolean;
  last_tested_at?: string | null;
}

export interface HqIntegrationSettings {
  slack: HqSlackIntegrationConfig;
  google_calendar: HqGoogleCalendarIntegrationConfig;
  secom: HqAccessTerminalConfig;
  adt_caps: HqAccessTerminalConfig;
  kt_telecop: HqAccessTerminalConfig;
}

export interface HqNoticeComment {
  id: string;
  author_id?: string;
  author_name: string;
  content: string;
  created_at: string;
}

export type HqNoticeStatus = "PUBLISHED" | "SCHEDULED" | "HIDDEN" | "EXPIRED";

export interface HqNoticeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  author_id?: string;
  author_name: string;
  target_scope: "ALL" | "DEPT";
  target_departments?: string[];
  target_label: string;
  status: HqNoticeStatus;
  scheduled_at?: string | null;
  expires_at?: string | null;
  is_pinned?: boolean;
  reactions: Record<string, string[]>;
  comments: HqNoticeComment[];
  created_at: string;
  updated_at: string;
}

export interface HqPersonnelAppointmentItem {
  id: string;
  event_type: "인사 정보 변경" | "정보 생성";
  status: "완료" | "예약" | "취소";
  actor_name: string;
  acted_at: string;
  effective_date: string;
  target_member_id?: string;
  target_member_name: string;
  appointment_label?: string;
  memo?: string;
  summary?: string;
}

export interface HqInviteCandidateItem {
  id: string;
  name: string;
  email: string;
  phone?: string;
  department: string;
  job_title: string;
  hire_date: string;
  status: "초대 전" | "가입 대기 중" | "정보 입력 중";
  created_at: string;
}

export interface HqHrLifecycleState {
  onboarding_templates: string[];
  offboarding_templates: string[];
  completed_checks: Record<string, string[]>;
  appointments: HqPersonnelAppointmentItem[];
  invitations: HqInviteCandidateItem[];
}

export type HqMeetingRsvpStatus = "ATTENDING" | "MAYBE" | "DECLINED";

export interface HqMeetingAttendee {
  member_id?: string;
  name: string;
  department?: string;
  rsvp: HqMeetingRsvpStatus;
}

export interface HqMeetingItem {
  id: string;
  title: string;
  has_schedule: boolean;
  start_at: string | null;
  end_at: string | null;
  location_or_url: string;
  organizer_id?: string;
  organizer_name: string;
  organizer_dept?: string;
  attendees: HqMeetingAttendee[];
  agenda: string;
  summary_notes: string;
  created_at: string;
  updated_at: string;
}

export interface HqLeaveAdjustmentItem {
  id: string;
  member_id: string;
  member_name: string;
  year_month: string; // 예: "2026-11"
  delta_days: number; // 예: +2 또는 -0.5
  reason: string;
  actor_name: string;
  created_at: string;
}

export interface HqLeavePromotionCampaign {
  year: number;
  is_active: boolean;
  due_date: string;
  started_by: string;
  started_at: string;
}

export interface HqAnnualLeavePlanItem {
  id: string;
  year: number;
  member_id: string;
  member_name: string;
  department: string;
  planned_dates: string[];
  memo: string;
  submitted_at: string;
}

export interface HqCustomLeaveGrantItem {
  id: string;
  member_id: string;
  member_name: string;
  leave_id: string; // 예: "cl-reward", "cl-subfertility"
  leave_name: string;
  granted_amount: number; // 일수 (시간 단위 부여 시 8시간=1일 환산 또는 일수)
  reason: string;
  actor_name: string;
  created_at: string;
}

export interface HqUploadedMonthlyUsageItem {
  member_id: string;
  member_name: string;
  year: number;
  months: number[]; // 길이 12 배열 (1월~12월 업로드 사용일수)
  updated_at: string;
}

export type HqPromotionKind = "연차" | "월차 1차" | "월차 2차";
export type HqPromotionTargetStatus = "PENDING" | "COMPLETED" | "EXPIRED";

export interface HqLeavePromotionTargetItem {
  id: string;
  year: number;
  member_id: string;
  member_name: string;
  department: string;
  employee_no?: string;
  promo_type: HqPromotionKind;
  expire_date: string; // 예: "2027-01-01" (2026.12.31 경과 소멸일)
  due_date: string; // 작성 기한 YYYY-MM-DD
  status: HqPromotionTargetStatus;
  requested_by: string;
  requested_at: string;
}

export interface HqCompLeaveGrantItem {
  id: string;
  member_id: string;
  member_name: string;
  department: string;
  period_start: string;
  period_end: string;
  overtime_minutes: number;
  granted_minutes: number;
  overtime_category: string; // 예: "법정근로내 연장", "연장근로"
  actor_name: string;
  created_at: string;
}

export interface HqHolidaySubstituteItem {
  id: string;
  member_id: string;
  member_name: string;
  department: string;
  holiday_date: string; // 원래 휴일 (예: "2026-11-22")
  holiday_kind: string; // "주휴일" | "공휴일"
  substitute_date: string; // 대체 휴무일 (예: "2026-11-24")
  worked_minutes: number;
  memo?: string;
  actor_name: string;
  created_at: string;
}

export interface HqAttendanceLockItem {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  target_scope: "ALL" | "DEPT";
  target_departments?: string[];
  locked_by: string;
  locked_at: string;
}

export interface HqContractCustomField {
  id: string;
  label: string;
  token: string; // 예: "{{원고매수}}"
  default_value?: string;
}

export interface HqContractTemplateItem {
  id: string;
  name: string;
  description: string;
  category_name: string; // 예: "자동계약서", "인사·서약서", "출판·외주 계약서"
  mapped_category: HqContractCategory;
  tags: string[];
  body_text: string;
  is_archived: boolean;
  is_system_seed?: boolean;
  updated_by: string;
  updated_at: string;
  created_at: string;
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
  annual_leave_settings?: HqAnnualLeaveGlobalSettings;
  custom_leaves?: HqCustomLeaveItem[];
  payroll_settings?: HqPayrollSettings;
  retiree_doc_settings?: HqRetireeDocSettingItem[];
  security_settings?: HqSecuritySettings;
  permission_settings?: HqPermissionSettings;
  integration_settings?: HqIntegrationSettings;
  hr_lifecycle_state?: HqHrLifecycleState;
}

export type HqWorkflowFieldType =
  | "TEXT"
  | "NUMBER"
  | "KRW"
  | "USD"
  | "JPY"
  | "DATE"
  | "SELECT"
  | "MULTI_SELECT"
  | "REF_DOC"
  | "MEMBER_NAME"
  | "MEMBER_NICKNAME"
  | "MEMBER_ENG_NAME"
  | "MEMBER_EMAIL"
  | "MEMBER_PHONE"
  | "MEMBER_BIRTH"
  | "HR_EMP_NO"
  | "HR_DEPT"
  | "HR_TITLE"
  | "HR_JOB"
  | "HR_POSITION"
  | "HR_HIRE_DATE";

export interface HqWorkflowFieldDef {
  id: string;
  type: HqWorkflowFieldType;
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface HqWorkflowFormDef {
  id: string;
  category_name: string;
  title: string;
  description: string;
  icon: string;
  icon_bg?: string;
  mapped_doc_type: HqApprovalDocType;
  fields: HqWorkflowFieldDef[];
  body_template: string;
  ref_file_url?: string | null;
  ref_file_name?: string | null;
  attachment_mode: "NONE" | "OPTIONAL" | "REQUIRED";
  use_body: boolean;
  allow_doc_edit: boolean;
  is_smart_form?: boolean;
  allow_edit: boolean;
  per_requester: boolean;
  cc_list: HqPolicyAssignee[];
  steps: HqPolicyStep[];
  requester_rules?: HqPolicyRequesterRule[];
  updated_at?: string;
}

export interface HqWorkflowDocAttachment {
  name: string;
  url: string;
}

export interface HqWorkflowDocComment {
  id: string;
  author_id: string;
  author_name: string;
  author_dept: string;
  content: string;
  created_at: string;
}

export interface HqWorkflowDocMeta {
  approval_id: string;
  form_id: string | null;
  form_title: string;
  form_icon: string;
  cc_member_ids: string[];
  cc_member_names: string[];
  field_values: Record<string, string>;
  field_labels?: Record<string, string>;
  ref_doc_id?: string | null;
  ref_doc_no?: string | null;
  ref_doc_title?: string | null;
  attachments: HqWorkflowDocAttachment[];
  comments: HqWorkflowDocComment[];
}

export interface HqWorkflowSavedView {
  id: string;
  name: string;
  scope: "MY" | "COMPANY";
  subTab: string;
  myRoleFilter: "ALL" | "MINE" | "MY_TURN";
  drafterIds: string[];
  approverIds: string[];
  ccIds: string[];
  formIds: string[];
  statusFilters: HqApprovalStatus[];
  datePreset: string;
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
