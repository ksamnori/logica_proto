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

export interface HqMember {
  instructor_id: string;
  name: string;
  email: string;
  phone: string;
  profile_image_url: string | null;
  tenant_id: string | null;
  tenant_name: string;
  is_hq_tenant: boolean;
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
