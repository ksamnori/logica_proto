// src/lib/hq/constants.ts
import type {
  HqApprovalDocType,
  HqContractCategory,
  HqContractTaxType,
  HqPayrollType,
  HqPubStage,
  HqRankCode,
  HqWorkMode,
} from "./types";

export const FALLBACK_HQ_TENANT_ID = "d59395b0-8c9c-4dd3-9e25-ff569da98abc";

export const FALLBACK_TENANT_NAMES: Record<string, string> = {
  "1ff4299c-d72b-4d99-97b0-45fee08e3b73": "대치 본원",
  "d59395b0-8c9c-4dd3-9e25-ff569da98abc": "본사",
  "e24e540f-ebdd-40eb-b20b-696c113def6d": "서초 가맹점",
};

export interface RankMeta {
  code: HqRankCode;
  level: number;
  label: string;
  shortLabel: string;
  defaultTitle: string;
  badgeClass: string;
  description: string;
}

export const HQ_RANKS: Record<HqRankCode, RankMeta> = {
  STAFF: {
    code: "STAFF",
    level: 1,
    label: "사원 · 연구원 (Lv.1)",
    shortLabel: "사원·연구원",
    defaultTitle: "연구원",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    description: "실무 담당자 (사원, 연구원, 편집자, 주임, 인턴)",
  },
  SENIOR: {
    code: "SENIOR",
    level: 2,
    label: "선임 · 대리 · 과장 (Lv.2)",
    shortLabel: "선임·대리",
    defaultTitle: "선임연구원",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    description: "중급 실무자 (선임연구원, 책임편집자, 대리, 과장, 차장)",
  },
  TEAM_LEAD: {
    code: "TEAM_LEAD",
    level: 3,
    label: "팀장 · 편집장 (Lv.3)",
    shortLabel: "팀장·편집장",
    defaultTitle: "팀장",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    description: "부서 1차 결재권자 · 소액/단기연차 전결권자",
  },
  DIRECTOR: {
    code: "DIRECTOR",
    level: 4,
    label: "본부장 · 이사 (Lv.4)",
    shortLabel: "본부장·이사",
    defaultTitle: "본부장",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    description: "2차 임원 결재권자 · 중액 품의/지출 전결권자",
  },
  CEO: {
    code: "CEO",
    level: 5,
    label: "대표 · 소장 (Lv.5)",
    shortLabel: "대표·소장",
    defaultTitle: "대표",
    badgeClass: "bg-indigo-50 text-indigo-800 border-indigo-200",
    description: "최고 결재권자 · 인사/출판/예산 총괄",
  },
};

export const HQ_RANK_LIST: RankMeta[] = [
  HQ_RANKS.STAFF,
  HQ_RANKS.SENIOR,
  HQ_RANKS.TEAM_LEAD,
  HQ_RANKS.DIRECTOR,
  HQ_RANKS.CEO,
];

export const HQ_DEFAULT_DEPARTMENTS = [
  "경영지원팀",
  "연구개발팀",
  "출판편집팀",
  "디자인팀",
  "제작·마케팅팀",
  "학원사업팀",
  "IT개발팀",
  "임원실",
] as const;

export const HQ_EMPLOYMENT_TYPES = [
  "정규직",
  "계약직",
  "수습",
  "프리랜서",
  "임원",
] as const;

export const APPROVAL_DOC_META: Record<
  HqApprovalDocType,
  {
    label: string;
    shortLabel: string;
    icon: string;
    badgeClass: string;
    desc: string;
  }
> = {
  GENERAL: {
    label: "일반 기안서",
    shortLabel: "일반기안",
    icon: "📄",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    desc: "신간 출간 기획안, 인쇄 발주 협조, 주요 의사결정 기안",
  },
  LEAVE: {
    label: "휴가 · 연차 신청서",
    shortLabel: "휴가신청",
    icon: "🌴",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    desc: "연차, 반차, 경조사, 공가 신청 (승인 시 잔여연차 및 근태표 자동 반영)",
  },
  PURCHASE: {
    label: "구매 · 인쇄발주 품의서",
    shortLabel: "구매·인쇄품의",
    icon: "🛒",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    desc: "신간/중쇄 인쇄 발주, 용지 구매, 서체·장비 도입, 외주 사전 품의",
  },
  EXPENSE: {
    label: "지출결의서 (비용 정산)",
    shortLabel: "지출결의",
    icon: "💳",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    desc: "법인카드·개인경비·인쇄 세금계산서 승인 (승인 즉시 비용 장부 연동)",
  },
};

export const LEAVE_TYPES: {
  label: string;
  defaultDays: number;
  deductAnnual: boolean;
}[] = [
  { label: "연차", defaultDays: 1.0, deductAnnual: true },
  { label: "오전반차", defaultDays: 0.5, deductAnnual: true },
  { label: "오후반차", defaultDays: 0.5, deductAnnual: true },
  { label: "마감대체휴무", defaultDays: 1.0, deductAnnual: false },
  { label: "경조사", defaultDays: 1.0, deductAnnual: false },
  { label: "병가", defaultDays: 1.0, deductAnnual: false },
  { label: "공가/예비군", defaultDays: 1.0, deductAnnual: false },
];

export const EXPENSE_CATEGORIES = [
  "도서/인쇄/제작비",
  "외주/용역비",
  "식대/복리후생",
  "교통/인쇄감리출장",
  "서체/소프트웨어/구독",
  "접대/저자미팅비",
  "사무용품/비품",
  "기타",
] as const;

export const EXPENSE_CATEGORY_POLICY: Record<
  string,
  { limitText: string; guide: string }
> = {
  "도서/인쇄/제작비": {
    limitText: "30만원 초과 시 사전 품의",
    guide: "인쇄·제본비, 용지대, 색교정 샘플, 기획 참고도서 구매",
  },
  "외주/용역비": {
    limitText: "전자계약·원천징수 확인",
    guide: "외주 조판, 표지/내지 일러스트, 교정·교열, 문항 검토 용역",
  },
  "식대/복리후생": {
    limitText: "1인당 2만원 이내 권장",
    guide: "마감 야근 식대, 팀 회식 및 편집실 다과 구매",
  },
  "교통/인쇄감리출장": {
    limitText: "실비 정산",
    guide: "파주/고양 인쇄소 현장 감리 교통비, 도서 샘플 퀵/용달비",
  },
  "서체/소프트웨어/구독": {
    limitText: "신규 구독 시 팀장 승인",
    guide: "Adobe CC, 폰트 라이선스, AI 툴, 클라우드 구독",
  },
  "접대/저자미팅비": {
    limitText: "참석자 명단 기재 필수",
    guide: "저자·출제위원·총판/서점 관계자 미팅 다과 및 식사",
  },
  "사무용품/비품": {
    limitText: "30만원 이하 팀장 전결",
    guide: "교정용 출력 토너/용지, 문구류, 전산 소모품",
  },
  기타: { limitText: "상세 사유 기재", guide: "기타 출판 본부 운영 제반 비용" },
};

export const PAYMENT_METHODS = [
  "법인카드",
  "개인카드(청구)",
  "계좌이체(세금계산서)",
  "현금영수증",
] as const;

// 직급·금액별 자동 전결 기준 상수
export const AUTO_DELEGATION_RULES = {
  TEAM_LEAD_MAX_AMOUNT: 300_000, // 30만원 이하: 팀장(Lv.3) 전결 가능
  DIRECTOR_MAX_AMOUNT: 1_000_000, // 100만원 이하: 본부장/이사(Lv.4) 전결 가능 (초과 시 대표 최종승인)
  TEAM_LEAD_MAX_LEAVE_DAYS: 3.0, // 3일 이하 연차/반차: 팀장(Lv.3) 전결 가능
};

// ============================================================================
// 출퇴근 · 유연근무 상수 (15인 출판사 맞춤: 시차출퇴근 · 재택원고 · 인쇄감리 외근)
// ============================================================================
export const WEEKLY_BASE_MINUTES = 40 * 60; // 주 40시간 (2,400분)
export const WEEKLY_WARN_MINUTES = 45 * 60; // 주 45시간 주의
export const WEEKLY_MAX_MINUTES = 52 * 60; // 주 52시간 법정 한도 (3,120분)

export const ATTENDANCE_MODES: Record<
  HqWorkMode,
  {
    label: string;
    shortLabel: string;
    scheduleText: string;
    icon: string;
    badgeClass: string;
    defaultLocation: string;
  }
> = {
  OFFICE: {
    label: "정규 출근 (09:00~18:00)",
    shortLabel: "본사 출근",
    scheduleText: "09:00 ~ 18:00",
    icon: "🏢",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    defaultLocation: "본사 연구·편집실",
  },
  FLEX_08: {
    label: "시차출퇴근 8시형 (08:00~17:00)",
    shortLabel: "시차 08시",
    scheduleText: "08:00 ~ 17:00",
    icon: "🌅",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    defaultLocation: "본사 (얼리버드)",
  },
  FLEX_10: {
    label: "시차출퇴근 10시형 (10:00~19:00)",
    shortLabel: "시차 10시",
    scheduleText: "10:00 ~ 19:00",
    icon: "🕙",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    defaultLocation: "본사 (시차 10시)",
  },
  FLEX_11: {
    label: "시차출퇴근 11시형 (11:00~20:00)",
    shortLabel: "시차 11시",
    scheduleText: "11:00 ~ 20:00",
    icon: "🕚",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    defaultLocation: "본사 (마감집중형)",
  },
  REMOTE: {
    label: "재택근무 (원고집필 · 교정)",
    shortLabel: "재택근무",
    scheduleText: "09:00 ~ 18:00",
    icon: "🏠",
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
    defaultLocation: "재택 (원고·문항 검토)",
  },
  OUTSIDE: {
    label: "외근 · 인쇄감리 (현장 직출/직퇴)",
    shortLabel: "외근·감리",
    scheduleText: "현장 탄력",
    icon: "🖨️",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    defaultLocation: "인쇄소 감리 / 외부 저자 미팅",
  },
  LEAVE: {
    label: "휴가 · 반차",
    shortLabel: "휴가·반차",
    scheduleText: "종일/반일",
    icon: "🌴",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    defaultLocation: "휴가 (승인됨)",
  },
};

// ============================================================================
// 전자계약 · 저작권/외주 계약 템플릿 상수
// ============================================================================
export const CONTRACT_CATEGORIES: Record<
  HqContractCategory,
  {
    label: string;
    shortLabel: string;
    icon: string;
    targetDefault: "INTERNAL" | "EXTERNAL";
    taxDefault: HqContractTaxType;
    badgeClass: string;
    desc: string;
  }
> = {
  LABOR: {
    label: "표준 근로계약서",
    shortLabel: "근로계약",
    icon: "📋",
    targetDefault: "INTERNAL",
    taxDefault: "FOUR_INSURANCE",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    desc: "신규 입사자·계약직 근로조건, 근무시간(유연근무 포함), 연차휴가 명시",
  },
  SALARY: {
    label: "연봉계약서",
    shortLabel: "연봉계약",
    icon: "💼",
    targetDefault: "INTERNAL",
    taxDefault: "FOUR_INSURANCE",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    desc: "연간 총 급여액, 월 기본급 및 비과세 식대(20만원) 구성 합의",
  },
  NDA: {
    label: "비밀유지서약서 (미출간 원고·문항 보호)",
    shortLabel: "비밀유지(NDA)",
    icon: "🛡️",
    targetDefault: "INTERNAL",
    taxDefault: "NONE",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    desc: "미출간 신간 기획안, 자체 문항 DB, 해설 원고 및 저자 정보 유출 방지",
  },
  OUTSOURCING: {
    label: "출판 외주 용역 표준계약서",
    shortLabel: "외주용역계약",
    icon: "🎨",
    targetDefault: "EXTERNAL",
    taxDefault: "BIZ_33",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    desc: "조판·표지/내지 디자인·일러스트·교정교열·문항출제 외주 납품 및 저작권 귀속",
  },
  ROYALTY: {
    label: "출판권 설정 · 원고 집필 계약서",
    shortLabel: "출판권·인세계약",
    icon: "📖",
    targetDefault: "EXTERNAL",
    taxDefault: "BIZ_33",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    desc: "저자 원고 인도 기한, 배타적 발행권 설정 기간, 인세율(%) 또는 매절 원고료 약정",
  },
};

export const CONTRACT_TAX_LABELS: Record<HqContractTaxType, string> = {
  FOUR_INSURANCE: "4대보험 근로소득",
  BIZ_33: "사업소득 원천징수 (3.3%)",
  OTHER_88: "기타소득 원천징수 (8.8%)",
  INVOICE: "세금계산서 (부가세 별도)",
  NONE: "금전 지급 없음 (서약)",
};

export function buildContractTemplateBody(params: {
  category: HqContractCategory;
  counterpartyName: string;
  counterpartyRole: string;
  department: string;
  bookTitle?: string;
  startDate: string;
  endDate?: string;
  amount: number;
  royaltyRate?: number | null;
}): string {
  const name = params.counterpartyName || "계약상대방";
  const role = params.counterpartyRole || "담당자";
  const book = params.bookTitle || "대상 도서(프로젝트)";
  const start = params.startDate || new Date().toISOString().slice(0, 10);
  const end = params.endDate || "별도 합의 시까지";
  const amtStr = params.amount > 0 ? `${params.amount.toLocaleString("ko-KR")}원` : "별도 정산 기준";
  const monthlyGross = params.amount > 0 ? Math.round(params.amount / 12) : 0;
  const mealPay = monthlyGross > 200_000 ? 200_000 : 0;
  const basePay = Math.max(0, monthlyGross - mealPay);

  switch (params.category) {
    case "LABOR":
      return `제1조 (계약 당사자 및 목적)
"갑" 천종현수학연구소와 "을" ${name}(${params.department || "본부"} · ${role})은 상호 신의와 성실로써 본 근로계약을 체결한다.

제2조 (근로계약 기간 및 수습)
1. 계약 시작일: ${start} (종료일: ${end === "별도 합의 시까지" ? "기간의 정함이 없음(정규직)" : end})
2. 신규 입사자의 경우 입사일로부터 3개월을 수습기간으로 하며, 업무 적격성 평가 후 본채용을 확정한다.

제3조 (근무 장소 및 담당 업무)
1. 근무 장소: "갑"의 본사 편집·연구실 (단, 유연근무 승인 시 재택근무 또는 인쇄소 감리 외근 가능)
2. 담당 업무: 출판 기획·연구·편집 및 부수 업무 (${params.department || "본부"})

제4조 (근로시간 및 유연근무)
1. 소정근로시간은 1일 8시간, 주 40시간을 원칙으로 하며 휴게시간은 1일 1시간(12:00~13:00)으로 한다.
2. 출판 마감 일정에 따라 "갑"의 시차출퇴근제(08시~11시 출근) 및 재택근무 규정을 활용할 수 있으며, 주 최대 근로시간은 52시간을 초과하지 아니한다.

제5조 (임금 및 지급일)
1. 연간 총 계약 급여액: ${amtStr} (월 환산 ${monthlyGross.toLocaleString("ko-KR")}원 = 기본급 ${basePay.toLocaleString("ko-KR")}원 + 비과세 식대 ${mealPay.toLocaleString("ko-KR")}원)
2. 급여는 매월 1일부터 말일까지 산정하여 당월 25일 "을" 명의 계좌로 지급하며, 4대보험료 및 근로소득세를 원천징수한다.

제6조 (연차유급휴가 및 저작물 귀속)
1. 연차유급휴가는 근로기준법에 따라 부여한다.
2. "을"이 재직 중 업무상 작성한 교재 원고, 문항, 편집 디자인 등 업무상저작물의 저작재산권은 저작권법 제9조에 따라 "갑"에게 귀속된다.`;

    case "SALARY":
      return `제1조 (연봉 적용 기간)
본 연봉계약의 적용 기간은 ${start}부터 ${end}까지로 한다.

제2조 (연봉 총액 및 월 지급 구성)
1. 연봉 총액: 금 ${amtStr}정 (세전 기준)
2. 월 지급액(${monthlyGross.toLocaleString("ko-KR")}원) 세부 구성:
   - 월 기본급: ${basePay.toLocaleString("ko-KR")}원
   - 비과세 식대: ${mealPay.toLocaleString("ko-KR")}원
3. 매월 25일 법정 4대보험 근로자 부담분 및 소득세·지방소득세를 공제한 실지급액을 지급한다.

제3조 (비밀유지 의무)
"을" ${name}은 본 연봉계약의 내용을 타 임직원 또는 제3자에게 누설하지 아니한다.`;

    case "NDA":
      return `제1조 (목적)
본 서약서는 "을" ${name}(${role})이 천종현수학연구소("갑")의 업무를 수행함에 있어 지득한 영업비밀 및 미출간 출판 자산을 보호함을 목적으로 한다.

제2조 (비밀정보의 범위)
1. 출간 전 기획 도서 구성안, 미공개 수학 문항 DB, 해설 원고, 일러스트 및 인디자인(InDesign) 조판 원본 파일
2. 저자·출제위원 명단, 인세율, 인쇄 단가, 전국 가맹학원 및 총판 거래 조건 일체

제3조 (준수 사항)
1. "을"은 사전 서면 승인 없이 비밀정보를 외부 반출, 개인 클라우드 업로드, 제3자 공유 또는 생성형 AI 외부 학습용으로 무단 입력하지 아니한다.
2. 계약 종료 또는 퇴직 시 보유 중인 모든 원고·조판 파일 및 사본을 즉시 반납·영구 삭제한다.`;

    case "OUTSOURCING":
      return `제1조 (용역 건명 및 과업 범위)
1. 대상 도서/프로젝트: ${book}
2. 과업 역할: ${role}
3. 계약 기간(납품 기한): ${start} ~ ${end}

제2조 (용역 대금 및 지급 조건)
1. 총 용역 대금: 금 ${amtStr}정
2. 세무 처리: 관련 세법에 따라 사업소득세(3.3%) 또는 기타소득세(8.8%)를 원천징수한 후(사업자 세금계산서 발행 시 부가세 별도) 검수 완료 익월 정기 지급일에 "을"의 지정 계좌로 지급한다.

제3조 (검수 및 수정 보완)
1. "을" ${name}은 편집 일정에 맞추어 작업 원본 파일(편집 가능 데이터 포함)을 인도하여야 하며, 교정 과정에서 발견된 오탈자·편집 오류에 대하여 하판 전까지 성실히 수정·보완한다.

제4조 (저작재산권 및 제3자 권리 보증)
1. 본 용역 결과물은 제3자의 저작권·초상권·폰트 라이선스를 침해하지 아니한 순수 창작물이어야 한다.
2. 대금 완납과 동시에 본 과업 결과물에 대한 저작재산권 일체(2차적저작물작성권 및 전자책·온라인 서비스 활용권 포함)는 "갑"에게 양도된다.`;

    case "ROYALTY":
      return `제1조 (출판권 및 배타적 발행권의 설정)
저작권자 "을" ${name}은 저작물 「${book}」에 대하여 천종현수학연구소("갑")에게 종이책 출판권 및 전자출판 배타적발행권을 설정한다.

제2조 (원고 인도 및 출간 시기)
1. 완전 원고 인도 기한: ${start}
2. 계약 유효 기간: 발행일로부터 ${end === "별도 합의 시까지" ? "5년 (만료 3개월 전 별도 통보 없을 시 1년씩 자동 연장)" : `${end}까지`}

제3조 (인세 및 선인세 지급 기준)
1. 인세율: 도서 정가의 ${params.royaltyRate ?? 10}% (발행부수 또는 실판매부수 기준은 특약에 따름)
2. 계약금(선인세) / 약정 원고료: ${amtStr}
3. 정산 주기: 매 분기 또는 반기 마감 후 익월 25일 원천징수세액(3.3%)을 공제하고 정산 내역서와 함께 지급한다.

제4조 (개정판 및 문제 DB 활용)
교육과정 개정에 따른 개정판 발행 시 "갑"과 "을"이 상호 협의하여 진행하며, 증정본은 초판 발행 시 10부를 "을"에게 무상 증정한다.`;
  }
}

// ============================================================================
// 급여 · 원천세(3.3% / 8.8%) · 인세 자동 계산기
// ============================================================================
export const PAYROLL_TYPE_META: Record<
  HqPayrollType,
  { label: string; shortLabel: string; badgeClass: string; taxSummary: string }
> = {
  EMPLOYEE: {
    label: "임직원 급여 (4대보험 · 근로소득)",
    shortLabel: "임직원 급여",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    taxSummary: "4대보험 근로자분 + 간이세액",
  },
  FREELANCER_33: {
    label: "외주 프리랜서 용역비 (사업소득 3.3%)",
    shortLabel: "외주 3.3%",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    taxSummary: "소득세 3.0% + 지방소득세 0.3%",
  },
  OTHER_88: {
    label: "원고료 · 문항검토 · 자문료 (기타소득 8.8%)",
    shortLabel: "기타소득 8.8%",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    taxSummary: "필요경비 60% 인정 · 실효 8.8%",
  },
  ROYALTY: {
    label: "저자 인세 정산 (사업소득 3.3%)",
    shortLabel: "저자 인세",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    taxSummary: "정가×부수×인세율 - 선인세 후 3.3%",
  },
};

export function calculatePayrollAmounts(input: {
  payType: HqPayrollType;
  basePay: number;
  mealAllowance?: number;
  overtimePay?: number;
  bonusPay?: number;
}) {
  const base = Math.max(0, Math.round(input.basePay || 0));
  const meal = Math.max(0, Math.round(input.mealAllowance || 0));
  const overtime = Math.max(0, Math.round(input.overtimePay || 0));
  const bonus = Math.max(0, Math.round(input.bonusPay || 0));

  if (input.payType === "EMPLOYEE") {
    const gross = base + meal + overtime + bonus;
    // 비과세 식대 최대 20만원 공제 후 과세표준 산출
    const nonTaxableMeal = Math.min(meal, 200_000);
    const taxable = Math.max(0, gross - nonTaxableMeal);

    // 10원 미만 절사 관행 반영
    const floor10 = (n: number) => Math.floor(n / 10) * 10;
    const nationalPension = floor10(Math.min(taxable, 6_170_000) * 0.045);
    const healthInsurance = floor10(taxable * 0.03545);
    const longTermCare = floor10(healthInsurance * 0.1295);
    const employmentInsurance = floor10(taxable * 0.009);

    // 월 과세급여 구간별 간이세액 근사치 (수동 보정 가능)
    let estIncomeTax = 0;
    if (taxable > 1_500_000) {
      if (taxable <= 3_000_000) {
        estIncomeTax = (taxable - 1_500_000) * 0.035;
      } else if (taxable <= 5_000_000) {
        estIncomeTax = 52_500 + (taxable - 3_000_000) * 0.085;
      } else {
        estIncomeTax = 222_500 + (taxable - 5_000_000) * 0.15;
      }
    }
    const incomeTax = floor10(estIncomeTax);
    const localIncomeTax = floor10(incomeTax * 0.1);
    const deductionTotal =
      nationalPension +
      healthInsurance +
      longTermCare +
      employmentInsurance +
      incomeTax +
      localIncomeTax;

    return {
      grossAmount: gross,
      nationalPension,
      healthInsurance,
      longTermCare,
      employmentInsurance,
      incomeTax,
      localIncomeTax,
      deductionTotal,
      netAmount: Math.max(0, gross - deductionTotal),
    };
  }

  const floor10 = (n: number) => Math.floor(n / 10) * 10;
  const gross = base + bonus;

  if (input.payType === "OTHER_88") {
    // 기타소득: 필요경비 60% 차감한 소득금액(40%)에 20% 소득세(= 총액의 8%) + 지방세 0.8%
    // 단, 기타소득금액 5만원 이하(지급액 125,000원 이하) 과세최저한 적용
    const incomeTax = gross <= 125_000 ? 0 : floor10(gross * 0.08);
    const localIncomeTax = floor10(incomeTax * 0.1);
    const deductionTotal = incomeTax + localIncomeTax;
    return {
      grossAmount: gross,
      nationalPension: 0,
      healthInsurance: 0,
      longTermCare: 0,
      employmentInsurance: 0,
      incomeTax,
      localIncomeTax,
      deductionTotal,
      netAmount: Math.max(0, gross - deductionTotal),
    };
  }

  // FREELANCER_33 및 ROYALTY: 사업소득 3% + 지방소득세 0.3% = 3.3%
  const incomeTax = floor10(gross * 0.03);
  const localIncomeTax = floor10(incomeTax * 0.1);
  const deductionTotal = incomeTax + localIncomeTax;
  return {
    grossAmount: gross,
    nationalPension: 0,
    healthInsurance: 0,
    longTermCare: 0,
    employmentInsurance: 0,
    incomeTax,
    localIncomeTax,
    deductionTotal,
    netAmount: Math.max(0, gross - deductionTotal),
  };
}

// ============================================================================
// 출판 공정 파이프라인 상수 (15인 출판사 핵심 7단계)
// ============================================================================
export const PUB_STAGES: {
  code: HqPubStage;
  label: string;
  shortLabel: string;
  defaultPct: number;
  badgeClass: string;
  headerClass: string;
}[] = [
  {
    code: "PLANNING",
    label: "1. 기획 · 집필",
    shortLabel: "기획·집필",
    defaultPct: 15,
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    headerClass: "border-t-slate-400",
  },
  {
    code: "MANUSCRIPT",
    label: "2. 원고 · 문항검수",
    shortLabel: "원고·문항검수",
    defaultPct: 30,
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    headerClass: "border-t-sky-500",
  },
  {
    code: "EDITING",
    label: "3. 편집 · 조판(1~3교)",
    shortLabel: "편집·교정",
    defaultPct: 55,
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    headerClass: "border-t-indigo-500",
  },
  {
    code: "DESIGN",
    label: "4. 표지 · 내지디자인",
    shortLabel: "표지·디자인",
    defaultPct: 70,
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    headerClass: "border-t-violet-500",
  },
  {
    code: "PROOF_FINAL",
    label: "5. 최종교열 · ISBN",
    shortLabel: "최종교열·ISBN",
    defaultPct: 85,
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    headerClass: "border-t-amber-500",
  },
  {
    code: "PRINTING",
    label: "6. 인쇄 · 감리(하판)",
    shortLabel: "인쇄·하판",
    defaultPct: 95,
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    headerClass: "border-t-rose-500",
  },
  {
    code: "PUBLISHED",
    label: "7. 출간 · 입고완료",
    shortLabel: "출간완료",
    defaultPct: 100,
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    headerClass: "border-t-emerald-500",
  },
];

export const PUB_PROOF_ROUNDS = [
  "기획안",
  "원고수합",
  "초교",
  "재교",
  "삼교",
  "사교(최종)",
  "색교정·하판",
  "인쇄감리중",
  "납품완료",
] as const;

/**
 * 기존 instructor 테이블의 chat_position / position 텍스트에서 본부 직급 코드(HqRankCode)를 추론
 */
export function inferRankFromPosition(
  chatPosition?: string | null,
  position?: string | null
): { rankCode: HqRankCode; jobTitle: string; isDeptHead: boolean } {
  const rawChat = (chatPosition || "").trim();
  const rawPos = (position || "").trim();
  const effective =
    rawChat ||
    (rawPos === "본사 관리자" || rawPos === "본사 직원" ? "" : rawPos) ||
    "사원";

  if (/대표|소장|회장|사장|발행인/.test(effective)) {
    return { rankCode: "CEO", jobTitle: effective, isDeptHead: true };
  }
  if (/본부장|부소장|이사|상무|전무|주간/.test(effective)) {
    return { rankCode: "DIRECTOR", jobTitle: effective, isDeptHead: true };
  }
  if (/팀장|실장|파트장|편집장|부서장|센터장/.test(effective)) {
    return { rankCode: "TEAM_LEAD", jobTitle: effective, isDeptHead: true };
  }
  if (/선임|수석|책임|과장|차장|대리/.test(effective)) {
    return { rankCode: "SENIOR", jobTitle: effective, isDeptHead: false };
  }
  return {
    rankCode: "STAFF",
    jobTitle: effective || "사원",
    isDeptHead: false,
  };
}

export function getRankLevel(code?: string | null): number {
  if (!code) return 1;
  return HQ_RANKS[code as HqRankCode]?.level ?? 1;
}

export function getRankMeta(code?: string | null): RankMeta {
  if (code && code in HQ_RANKS) return HQ_RANKS[code as HqRankCode];
  return HQ_RANKS.STAFF;
}
