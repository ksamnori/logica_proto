-- ============================================================================
-- 천종현수학연구소 본부(HQ · 출판사) 전용 올인원 HR · 전자결재 · 전자계약 · 정산 · 출판공정 스키마
-- 학원(가맹점) 테이블과 완전히 분리된 hq_* 네임스페이스 테이블 정의
-- Supabase SQL Editor에 전체 붙여넣기 후 실행하세요 (중복 실행 안전 / 기존 데이터 100% 보존)
-- ============================================================================

-- 1. 본부 구성원 인사 프로필 (Core HR)
CREATE TABLE IF NOT EXISTS public.hq_member_profile (
  instructor_id uuid PRIMARY KEY REFERENCES public.instructor(instructor_id) ON DELETE CASCADE,
  employee_no text UNIQUE,
  department text NOT NULL DEFAULT '미지정',
  rank_code text NOT NULL DEFAULT 'STAFF'
    CHECK (rank_code IN ('STAFF', 'SENIOR', 'TEAM_LEAD', 'DIRECTOR', 'CEO')),
  job_title text NOT NULL DEFAULT '사원',
  is_dept_head boolean NOT NULL DEFAULT false,
  employment_type text NOT NULL DEFAULT '정규직',
  work_status text NOT NULL DEFAULT '재직'
    CHECK (work_status IN ('재직', '휴직', '퇴직')),
  hire_date date,
  resign_date date,
  birth_date date,
  annual_leave_total numeric(4,1) NOT NULL DEFAULT 15.0,
  annual_leave_used numeric(4,1) NOT NULL DEFAULT 0.0,
  bank_name text,
  bank_account text,
  account_holder text,
  extension_no text,
  emergency_contact text,
  address text,
  job_description text,
  hr_memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_member_dept ON public.hq_member_profile(department);
CREATE INDEX IF NOT EXISTS idx_hq_member_rank ON public.hq_member_profile(rank_code);
ALTER TABLE public.hq_member_profile ADD COLUMN IF NOT EXISTS is_hr_admin boolean NOT NULL DEFAULT false;

-- 2. 본부 전자결재 문서 마스터 (일반기안 / 휴가신청 / 구매품의 / 지출결의)
CREATE TABLE IF NOT EXISTS public.hq_approval_doc (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no text UNIQUE NOT NULL,
  doc_type text NOT NULL
    CHECK (doc_type IN ('GENERAL', 'LEAVE', 'PURCHASE', 'EXPENSE')),
  title text NOT NULL,
  content text,
  drafter_id uuid NOT NULL REFERENCES public.instructor(instructor_id),
  drafter_name text NOT NULL,
  drafter_dept text NOT NULL DEFAULT '',
  drafter_rank text NOT NULL DEFAULT 'STAFF',
  drafter_title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED')),
  current_step_order int NOT NULL DEFAULT 1,
  total_steps int NOT NULL DEFAULT 1,
  is_auto_delegated boolean NOT NULL DEFAULT false,
  amount bigint NOT NULL DEFAULT 0,
  effective_date date,
  end_date date,
  leave_type text,
  leave_days numeric(4,1) NOT NULL DEFAULT 0,
  handover_name text,
  expense_category text,
  payment_method text,
  merchant_name text,
  card_last4 text,
  receipt_url text,
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  urgent boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_approval_drafter ON public.hq_approval_doc(drafter_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hq_approval_status ON public.hq_approval_doc(status, submitted_at DESC);

-- 3. 전자결재 단계별 결재선 및 결재 이력 (1차 검토 → 2차 임원 → 최종 승인)
CREATE TABLE IF NOT EXISTS public.hq_approval_step (
  step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.hq_approval_doc(approval_id) ON DELETE CASCADE,
  step_order int NOT NULL,
  step_role text NOT NULL DEFAULT 'APPROVER',
  approver_id uuid NOT NULL REFERENCES public.instructor(instructor_id),
  approver_name text NOT NULL,
  approver_dept text NOT NULL DEFAULT '',
  approver_rank text NOT NULL DEFAULT '',
  approver_title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'CURRENT', 'APPROVED', 'REJECTED', 'SKIPPED')),
  comment text,
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_hq_approval_step_approver ON public.hq_approval_step(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_hq_approval_step_doc ON public.hq_approval_step(approval_id, step_order);

-- 4. 본부 비용 관리 장부 (지출결의 자동 연동 + 법인카드/영수증 직접 등록)
CREATE TABLE IF NOT EXISTS public.hq_expense (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_no text UNIQUE NOT NULL,
  source_type text NOT NULL DEFAULT 'DIRECT'
    CHECK (source_type IN ('DIRECT', 'APPROVAL')),
  approval_id uuid UNIQUE REFERENCES public.hq_approval_doc(approval_id) ON DELETE SET NULL,
  requester_id uuid NOT NULL REFERENCES public.instructor(instructor_id),
  requester_name text NOT NULL,
  department text NOT NULL DEFAULT '',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL,
  payment_method text NOT NULL DEFAULT '법인카드',
  merchant_name text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  tax_amount bigint NOT NULL DEFAULT 0,
  card_last4 text,
  description text,
  receipt_url text,
  settlement_status text NOT NULL DEFAULT '정산대기'
    CHECK (settlement_status IN ('정산대기', '정산완료', '반려')),
  settled_by text,
  settled_at timestamptz,
  admin_memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_expense_date ON public.hq_expense(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_hq_expense_requester ON public.hq_expense(requester_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_hq_expense_status ON public.hq_expense(settlement_status);

-- 5. 출퇴근 · 유연근무 근태 기록 (정규/시차출퇴근/재택원고/인쇄소외근/휴가 자동연동 & 주 52시간 관리)
CREATE TABLE IF NOT EXISTS public.hq_attendance (
  attendance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES public.instructor(instructor_id) ON DELETE CASCADE,
  member_name text NOT NULL,
  department text NOT NULL DEFAULT '',
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  work_mode text NOT NULL DEFAULT 'OFFICE'
    CHECK (work_mode IN ('OFFICE', 'FLEX_08', 'FLEX_10', 'FLEX_11', 'REMOTE', 'OUTSIDE', 'LEAVE')),
  status text NOT NULL DEFAULT 'WORKING'
    CHECK (status IN ('WORKING', 'DONE', 'LEAVE', 'HALF_LEAVE')),
  check_in_at timestamptz,
  check_out_at timestamptz,
  break_minutes int NOT NULL DEFAULT 60,
  worked_minutes int NOT NULL DEFAULT 0,
  overtime_minutes int NOT NULL DEFAULT 0,
  location_note text,
  memo text,
  approval_id uuid REFERENCES public.hq_approval_doc(approval_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_hq_attendance_date ON public.hq_attendance(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_hq_attendance_member ON public.hq_attendance(instructor_id, work_date DESC);

-- 6. 전자계약 · 저작권/외주 계약 관리 (근로·연봉·NDA + 출판외주용역·출판권/인세계약 + 전자서명)
CREATE TABLE IF NOT EXISTS public.hq_contract (
  contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no text UNIQUE NOT NULL,
  category text NOT NULL
    CHECK (category IN ('LABOR', 'SALARY', 'NDA', 'OUTSOURCING', 'ROYALTY')),
  target_type text NOT NULL DEFAULT 'INTERNAL'
    CHECK (target_type IN ('INTERNAL', 'EXTERNAL')),
  target_member_id uuid REFERENCES public.instructor(instructor_id) ON DELETE SET NULL,
  counterparty_name text NOT NULL,
  counterparty_role text NOT NULL DEFAULT '',
  counterparty_phone text,
  counterparty_email text,
  department text NOT NULL DEFAULT '',
  title text NOT NULL,
  book_title text,
  start_date date,
  end_date date,
  contract_amount bigint NOT NULL DEFAULT 0,
  royalty_rate numeric(5,2),
  tax_type text NOT NULL DEFAULT 'FOUR_INSURANCE'
    CHECK (tax_type IN ('FOUR_INSURANCE', 'BIZ_33', 'OTHER_88', 'INVOICE', 'NONE')),
  body_text text NOT NULL,
  special_terms text,
  status text NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED')),
  company_signer_name text NOT NULL DEFAULT '대표이사',
  company_signed_at timestamptz,
  party_signature_data text,
  party_signed_at timestamptz,
  created_by uuid REFERENCES public.instructor(instructor_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_contract_status ON public.hq_contract(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hq_contract_member ON public.hq_contract(target_member_id);

-- 7. 급여명세 · 외주 원천세(3.3% / 8.8%) · 저자 인세 정산 장부
CREATE TABLE IF NOT EXISTS public.hq_payroll (
  payroll_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_no text UNIQUE NOT NULL,
  pay_month text NOT NULL,
  pay_type text NOT NULL
    CHECK (pay_type IN ('EMPLOYEE', 'FREELANCER_33', 'OTHER_88', 'ROYALTY')),
  member_id uuid REFERENCES public.instructor(instructor_id) ON DELETE SET NULL,
  payee_name text NOT NULL,
  department_or_role text NOT NULL DEFAULT '',
  bank_info text,
  book_or_project text,
  base_pay bigint NOT NULL DEFAULT 0,
  meal_allowance bigint NOT NULL DEFAULT 0,
  overtime_pay bigint NOT NULL DEFAULT 0,
  bonus_pay bigint NOT NULL DEFAULT 0,
  gross_amount bigint NOT NULL DEFAULT 0,
  national_pension bigint NOT NULL DEFAULT 0,
  health_insurance bigint NOT NULL DEFAULT 0,
  long_term_care bigint NOT NULL DEFAULT 0,
  employment_insurance bigint NOT NULL DEFAULT 0,
  income_tax bigint NOT NULL DEFAULT 0,
  local_income_tax bigint NOT NULL DEFAULT 0,
  deduction_total bigint NOT NULL DEFAULT 0,
  net_amount bigint NOT NULL DEFAULT 0,
  calc_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID')),
  pay_date date,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_payroll_month ON public.hq_payroll(pay_month DESC, pay_type);
CREATE INDEX IF NOT EXISTS idx_hq_payroll_member ON public.hq_payroll(member_id, pay_month DESC);

-- 8. 출판 기획 · 편집 마감 & ISBN 공정 보드 (15인 출판사 핵심 파이프라인)
CREATE TABLE IF NOT EXISTS public.hq_publication (
  pub_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_code text UNIQUE NOT NULL,
  title text NOT NULL,
  subtitle text,
  series_name text,
  target_grade text,
  stage text NOT NULL DEFAULT 'PLANNING'
    CHECK (stage IN ('PLANNING', 'MANUSCRIPT', 'EDITING', 'DESIGN', 'PROOF_FINAL', 'PRINTING', 'PUBLISHED')),
  proof_round text DEFAULT '초교',
  progress_pct int NOT NULL DEFAULT 10,
  author_name text,
  editor_id uuid REFERENCES public.instructor(instructor_id) ON DELETE SET NULL,
  editor_name text,
  designer_name text,
  isbn text,
  edition_info text DEFAULT '초판 1쇄',
  list_price int NOT NULL DEFAULT 0,
  print_run int NOT NULL DEFAULT 0,
  print_vendor text,
  press_deadline date,
  publish_date date,
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_publication_stage ON public.hq_publication(stage, press_deadline);

-- 9. RLS 활성화 (서버 API에서 service_role 키로 검증 후 처리하므로 기본 차단으로 안전하게 보호)
ALTER TABLE public.hq_member_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_approval_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_approval_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_expense ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_publication ENABLE ROW LEVEL SECURITY;
