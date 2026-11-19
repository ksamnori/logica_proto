// src/lib/hq/contractTemplateEngine.ts
import {
  calcBreakMinutes,
  DEFAULT_WORK_RULES,
  formatHmToKoreanAmPm,
} from "./defaultWorkRules";
import type {
  HqCompanySettings,
  HqContractCategory,
  HqContractTaxType,
  HqContractTemplateItem,
  HqMember,
  HqWorkRuleItem,
} from "./types";

export interface PlaceholderFieldItem {
  label: string;
  token: string;
  insertText?: string; // 입력 필드 그룹(블록)일 때 삽입할 멀티라인 텍스트
}

export interface PlaceholderGroupDef {
  groupTitle: string;
  items: PlaceholderFieldItem[];
}

// 스크린샷 9~13의 플렉스 자동입력 필드 전체 그룹 1:1 재현 + 출판사 전용 변수
export const CONTRACT_PLACEHOLDER_GROUPS: PlaceholderGroupDef[] = [
  {
    groupTitle: "입력 필드 그룹",
    items: [
      {
        label: "계약서용 서명란",
        token: "{{계약서용 서명란}}",
        insertText: [
          "",
          "계약일: {{계약일}}",
          "",
          "[갑] 회사명: {{회사명}} / 주소: {{회사주소}} / 대표이사: {{대표자명}} {{회사 직인}}",
          "[을] 성명: {{구성원 이름}} / 연락처: {{구성원 연락처}} / 서명: {{구성원 직인}}",
        ].join("\n"),
      },
      {
        label: "서약서용 서명란",
        token: "{{서약서용 서명란}}",
        insertText: [
          "",
          "서약일: {{계약일}}",
          "소속: {{주조직}} ({{직위}})",
          "서약자 성명: {{구성원 이름}} {{구성원 직인}}",
          "귀사: {{회사명}} 대표이사 {{대표자명}} 귀하",
        ].join("\n"),
      },
      {
        label: "근로일별 근로시간표",
        token: "{{근로일별 근로시간표}}",
        insertText: [
          "[근로일 및 근로시간표]",
          "• 소정근로일: {{근로일}} (주휴일: {{주휴일}})",
          "• 근무시간: {{출근시간}} 시업 · 1일 {{소정근로시간}} 근무 (휴게시간: {{휴게시간}})",
        ].join("\n"),
      },
      {
        label: "임금·수당표 (포괄)",
        token: "{{임금·수당표 (포괄)}}",
        insertText: [
          "[포괄산정 임금 구성 내역]",
          "• 연간 총 계약금액: 금 {{계약금액}}원 (월 환산 {{월 지급액}}원)",
          "  1) 월 기본급(주휴수당 포함): {{기본급}}원",
          "  2) 포괄 고정연장근로수당({{포괄임금 고정초과근무 계약시간}} 기준): {{포괄임금 고정초과근무 수당}}원",
          "  3) 비과세 식대: {{식대 비과세}}원",
          "• 임금 지급일: {{급여일}}",
        ].join("\n"),
      },
      {
        label: "임금·수당표 (통상)",
        token: "{{임금·수당표 (통상)}}",
        insertText: [
          "[통상임금 구성 내역]",
          "• 연간 총 계약금액: 금 {{계약금액}}원 (월 지급액: {{월 지급액}}원)",
          "  1) 월 기본급: {{기본급}}원",
          "  2) 비과세 식대: {{식대 비과세}}원",
          "• 임금 지급일: {{급여일}}",
        ].join("\n"),
      },
    ],
  },
  {
    groupTitle: "서식정보 플레이스홀더",
    items: [
      { label: "회사명", token: "{{회사명}}" },
      { label: "회사주소", token: "{{회사주소}}" },
      { label: "사업자 등록번호", token: "{{사업자 등록번호}}" },
      { label: "대표자명", token: "{{대표자명}}" },
      { label: "회사 직인", token: "{{회사 직인}}" },
      { label: "회사 직인(서명란 포함)", token: "{{회사 직인(서명란 포함)}}" },
      { label: "구성원 직인", token: "{{구성원 직인}}" },
      { label: "구성원 직인(서명란 포함)", token: "{{구성원 직인(서명란 포함)}}" },
      { label: "계약일", token: "{{계약일}}" },
    ],
  },
  {
    groupTitle: "개인 정보 플레이스홀더",
    items: [
      { label: "구성원 이름", token: "{{구성원 이름}}" },
      { label: "구성원 주소", token: "{{구성원 주소}}" },
      { label: "구성원 연락처", token: "{{구성원 연락처}}" },
      { label: "구성원 법정 생년월일", token: "{{구성원 법정 생년월일}}" },
    ],
  },
  {
    groupTitle: "인사 정보 플레이스홀더",
    items: [
      { label: "사번", token: "{{사번}}" },
      { label: "주조직", token: "{{주조직}}" },
      { label: "직책", token: "{{직책}}" },
      { label: "직무", token: "{{직무}}" },
      { label: "직위", token: "{{직위}}" },
    ],
  },
  {
    groupTitle: "임금정보 플레이스홀더",
    items: [
      { label: "임금계약 시작일", token: "{{임금계약 시작일}}" },
      { label: "임금계약 종료일", token: "{{임금계약 종료일}}" },
      { label: "급여 지급기준", token: "{{급여 지급기준}}" },
      { label: "계약금액", token: "{{계약금액}}" },
      { label: "월 지급액", token: "{{월 지급액}}" },
      { label: "기본급", token: "{{기본급}}" },
      { label: "급여일", token: "{{급여일}}" },
      { label: "포괄임금 계약기준", token: "{{포괄임금 계약기준}}" },
      {
        label: "포괄임금 고정초과근무 계약시간",
        token: "{{포괄임금 고정초과근무 계약시간}}",
      },
      {
        label: "포괄임금 고정초과근무 수당",
        token: "{{포괄임금 고정초과근무 수당}}",
      },
      { label: "식대 비과세", token: "{{식대 비과세}}" },
    ],
  },
  {
    groupTitle: "계약 정보 플레이스홀더",
    items: [
      { label: "계약유형", token: "{{계약유형}}" },
      { label: "근로계약 시작일", token: "{{근로계약 시작일}}" },
      { label: "근로계약 종료일", token: "{{근로계약 종료일}}" },
      { label: "수습기간 시작일", token: "{{수습기간 시작일}}" },
      { label: "수습기간 종료일", token: "{{수습기간 종료일}}" },
      { label: "수습기간 급여지급률", token: "{{수습기간 급여지급률}}" },
    ],
  },
  {
    groupTitle: "근무 정보 플레이스홀더",
    items: [
      { label: "근로일", token: "{{근로일}}" },
      { label: "주휴일", token: "{{주휴일}}" },
      { label: "근무제", token: "{{근무제}}" },
      { label: "출근시간", token: "{{출근시간}}" },
      { label: "휴게시간", token: "{{휴게시간}}" },
      { label: "소정근로시간", token: "{{소정근로시간}}" },
    ],
  },
  {
    groupTitle: "출판·외주 전용 플레이스홀더",
    items: [
      { label: "대상 도서명", token: "{{도서명}}" },
      { label: "약정 인세율", token: "{{인세율}}" },
      { label: "소득 원천징수 구분", token: "{{세무구분}}" },
    ],
  },
];

export interface StarterTemplatePreset {
  id: string;
  title: string;
  categoryName: string;
  mappedCategory: HqContractCategory;
  description: string;
  bodyText: string;
}

// 스크린샷 9~13의 서식 템플릿 9종 + 천종현수학연구소 특화 3종 = 총 12종
export const STARTER_TEMPLATE_PRESETS: StarterTemplatePreset[] = [
  {
    id: "st-salary-inclusive",
    title: "연봉계약서 (포괄임금)",
    categoryName: "자동계약서",
    mappedCategory: "SALARY",
    description: "전사 포괄임금 기준 연간 임금계약 표준 양식",
    bodyText: [
      "{{회사명}}(이하 '갑'이라 한다)과 {{구성원 이름}}(이하 '을'이라 한다)은 다음과 같이 연봉계약을 체결한다.",
      "",
      "제1조 [계약 적용 기간]",
      "본 연봉계약의 적용 기간은 {{임금계약 시작일}}부터 {{임금계약 종료일}}까지로 한다.",
      "",
      "제2조 [연봉 총액 및 포괄임금 구성]",
      "• 연간 계약금액: 금 {{계약금액}}원 (월 지급 총액: 금 {{월 지급액}}원)",
      "  1) 월 기본급(주휴수당 포함): 금 {{기본급}}원",
      "  2) 고정 연장근로수당({{포괄임금 고정초과근무 계약시간}}): 금 {{포괄임금 고정초과근무 수당}}원",
      "  3) 비과세 식대: 금 {{식대 비과세}}원",
      "",
      "제3조 [지급일 및 방법]",
      "'갑'은 매월 {{급여일}}에 제세공과금 및 4대 사회보험료를 원천공제한 후 '을' 명의의 지정 계좌로 지급한다.",
      "",
      "제4조 [비밀유지]",
      "'을'은 본 연봉계약 내용을 제3자 및 타 구성원에게 누설하여서는 아니 된다.",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} ({{회사주소}}) 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] 소속: {{주조직}} / 성명: {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-labor-inclusive",
    title: "근로계약서 (정규직 선택적·포괄임금)",
    categoryName: "자동계약서",
    mappedCategory: "LABOR",
    description: "정규직 근로조건 및 포괄임금 통합 표준 근로계약서",
    bodyText: [
      "{{회사명}}(이하 '갑')과 {{구성원 이름}}(이하 '을')은 근로기준법을 준수하여 다음과 같이 근로계약을 체결한다.",
      "",
      "제1조 [근로계약 기간 및 수습]",
      "1. 근로개시일: {{근로계약 시작일}} (종료일: {{근로계약 종료일}})",
      "2. 신규 입사자의 경우 입사일로부터 3개월({{수습기간 종료일}}까지)을 수습기간으로 한다.",
      "",
      "제2조 [근무장소 및 담당업무]",
      "1. 근무장소: {{회사주소}} 및 회사가 지정하는 장소(원격·외근 포함)",
      "2. 소속 및 직무: {{주조직}} / {{직무}} ({{직위}})",
      "",
      "제3조 [소정근로시간 및 휴일]",
      "1. 근무형태: {{근무제}} (소정근로일: {{근로일}} / 주휴일: {{주휴일}})",
      "2. 시업 및 휴게: {{출근시간}} 출근 · 1일 {{소정근로시간}} 근무 (휴게시간: {{휴게시간}})",
      "3. 연차유급휴가는 근로기준법 및 취업규칙(회계연도 1월 1일 ~ 당해 연말 12월 31일 기준)에 따라 부여한다.",
      "",
      "제4조 [임금]",
      "• 연간 계약금액: 금 {{계약금액}}원 (월 지급액: 금 {{월 지급액}}원 / 지급일: {{급여일}})",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] 주소: {{구성원 주소}} / 연락처: {{구성원 연락처}} / 성명: {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-labor-fixed",
    title: "근로계약서 (정규직 고정근무 통상임금)",
    categoryName: "자동계약서",
    mappedCategory: "LABOR",
    description: "주 40시간 고정 출퇴근 통상임금제 근로계약서",
    bodyText: [
      "{{회사명}}(이하 '갑')과 {{구성원 이름}}(이하 '을')은 다음과 같이 정규직 근로계약을 체결한다.",
      "",
      "1. 근로계약기간: {{근로계약 시작일}} ~ 정함이 없음",
      "2. 근무부서 및 직위: {{주조직}} ({{직위}})",
      "3. 소정근로시간: {{근로일}} {{출근시간}} 시업, 1일 {{소정근로시간}} (휴게시간 {{휴게시간}}), 주휴일 매주 {{주휴일}}",
      "4. 임금(통상임금): 연봉 금 {{계약금액}}원 (월 기본급 {{기본급}}원, 식대 {{식대 비과세}}원), 매월 {{급여일}} 지급",
      "5. 연차휴가 및 복무규율은 취업규칙과 근로기준법에 따른다.",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-labor-staggered",
    title: "근로계약서 (정규직 시차근무 통상임금)",
    categoryName: "자동계약서",
    mappedCategory: "LABOR",
    description: "08:30 / 09:00 / 09:30 시차출퇴근제 적용 근로계약서",
    bodyText: [
      "{{회사명}}(이하 '갑')과 {{구성원 이름}}(이하 '을')은 시차출퇴근제를 포함한 근로계약을 다음과 같이 체결한다.",
      "",
      "1. 근로개시일: {{근로계약 시작일}}",
      "2. 소속 및 담당직무: {{주조직}} · {{직무}}",
      "3. 시차출퇴근 근로시간: 기본 시업 {{출근시간}}, 1일 {{소정근로시간}} 근무 (휴게 {{휴게시간}}), 회사 승인을 통해 시차 구간을 조정할 수 있다.",
      "4. 임금: 연간 금 {{계약금액}}원 (월 지급액 {{월 지급액}}원 / 매월 {{급여일}} 지급)",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-labor-hourly",
    title: "근로계약서 (계약직·단시간 시급제 통상임금)",
    categoryName: "자동계약서",
    mappedCategory: "LABOR",
    description: "단시간·기간제 연구보조 및 아르바이트용 근로계약서",
    bodyText: [
      "{{회사명}}(이하 '갑')과 {{구성원 이름}}(이하 '을')은 기간제·단시간 근로계약을 체결한다.",
      "",
      "1. 계약기간: {{근로계약 시작일}} ~ {{근로계약 종료일}}",
      "2. 근무일 및 근로시간: {{근로일}} / 시업 {{출근시간}} (1일 {{소정근로시간}}, 휴게 {{휴게시간}})",
      "3. 임금: {{계약금액}}원 기준 산정하며 매월 {{급여일}} 본인 계좌로 지급한다.",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-salary-ordinary",
    title: "연봉계약서 (통상임금)",
    categoryName: "자동계약서",
    mappedCategory: "SALARY",
    description: "통상임금 체계 기준 연간 임금계약서",
    bodyText: [
      "{{회사명}}(이하 '갑')과 {{구성원 이름}}(이하 '을')은 {{임금계약 시작일}} ~ {{임금계약 종료일}} 기간에 적용할 연봉계약을 체결한다.",
      "",
      "1. 연봉 총액: 금 {{계약금액}}원 (월 지급액: 금 {{월 지급액}}원)",
      "2. 세부 구성: 월 기본급 금 {{기본급}}원 + 비과세 식대 금 {{식대 비과세}}원",
      "3. 연장·야간·휴일근로 발생 시 근로기준법에 따른 가산수당을 별도 산정하여 매월 {{급여일}}에 지급한다.",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-nda",
    title: "비밀 유지 서약서",
    categoryName: "인사·서약서",
    mappedCategory: "NDA",
    description: "출판 미공개 원고·문항 DB·영업비밀 보호 서약서",
    bodyText: [
      "본인 {{구성원 이름}}(소속: {{주조직}}, 이하 '서약자')은 {{회사명}}(이하 '회사')에 재직 또는 업무를 수행함에 있어 다음 사항을 준수할 것을 엄숙히 서약합니다.",
      "",
      "1. 서약자는 회사의 미출간 수학 교재 원고, 문항 데이터베이스, 편집 조판 원본, 가맹 학원 및 저자 계약 정보 등 일체의 영업비밀을 외부에 유출하거나 사적 용도로 사용하지 않습니다.",
      "2. 재직 기간 중 직무상 작성한 교재 원고, 도형·삽화, 문항 해설 등 일체의 업무상저작물에 대한 저작재산권은 회사에 귀속됨을 확인합니다.",
      "3. 퇴직 후에도 회사의 사전 서면 승인 없이 재직 중 취득한 기밀자료를 보유·복제·누설하지 않으며, 위반 시 민·형사상 책임을 부담합니다.",
      "",
      "서약일: {{계약일}}",
      "서약자 성명: {{구성원 이름}} (연락처: {{구성원 연락처}}) {{구성원 직인}}",
      "{{회사명}} 대표이사 {{대표자명}} 귀하",
    ].join("\n"),
  },
  {
    id: "st-non-compete",
    title: "경업 금지 서약서",
    categoryName: "인사·서약서",
    mappedCategory: "NDA",
    description: "핵심 연구·출판 기획 인력 경업금지 및 전직제한 서약서",
    bodyText: [
      "본인 {{구성원 이름}}(소속: {{주조직}} / 직위: {{직위}})은 {{회사명}}의 핵심 커리큘럼 및 출판 영업비밀을 보호하기 위하여 다음 사항을 서약합니다.",
      "",
      "1. 재직 중 회사의 사전 허가 없이 동종 수학 교육·출판 업체에 겸직하거나 자문 행위를 하지 않습니다.",
      "2. 퇴직일로부터 1년간 회사의 미공개 신간 기획안 및 독자적 문항 설계 자산을 이용한 경업 행위나 거래처 유인 행위를 하지 않습니다.",
      "",
      "서약일: {{계약일}}",
      "서약자: {{구성원 이름}} {{구성원 직인}}",
      "{{회사명}} 대표이사 {{대표자명}} 귀하",
    ].join("\n"),
  },
  {
    id: "st-privacy-consent",
    title: "개인 정보 이용 동의서",
    categoryName: "인사·서약서",
    mappedCategory: "NDA",
    description: "인사관리·급여원천징수·4대보험 신고용 개인정보 동의서",
    bodyText: [
      "{{회사명}}은 근로계약 체결·유지, 급여 및 원천세 신고, 4대 사회보험 업무 처리를 위하여 아래와 같이 개인정보 및 고유식별정보를 수집·이용하고자 합니다.",
      "",
      "1. 수집 항목: 성명({{구성원 이름}}), 생년월일({{구성원 법정 생년월일}}), 주소({{구성원 주소}}), 연락처({{구성원 연락처}}), 급여계좌, 주민등록번호(원천세·4대보험 법령 의무 처리용)",
      "2. 보유 및 이용 기간: 재직 기간 및 근로기준법·국세기본법상 법정 보존 기간(퇴직 후 최대 5년)",
      "3. 동의를 거부할 권리가 있으나, 미동의 시 급여 지급 및 인사 행정이 제한될 수 있습니다.",
      "",
      "본인은 위 내용을 충분히 숙지하였으며 개인정보 수집·이용에 동의합니다.",
      "",
      "동의일: {{계약일}}",
      "동의자 성명: {{구성원 이름}} {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-pub-royalty",
    title: "저자 출판권 및 배타적 발행권 설정 계약서",
    categoryName: "출판·외주 계약서",
    mappedCategory: "ROYALTY",
    description: "단행본·사고력 수학교재 집필 저자 인세 약정 표준계약서",
    bodyText: [
      "저작권자 {{구성원 이름}}(이하 '저작권자')과 출판권자 {{회사명}}(이하 '출판사')은 저작물 「{{도서명}}」에 관하여 다음과 같이 출판권 및 배타적발행권 설정계약을 체결한다.",
      "",
      "제1조 [권리의 설정]",
      "'저작권자'는 본 저작물에 대하여 종이책 출판권 및 전자책 배타적발행권을 '출판사'에게 독점 설정한다.",
      "",
      "제2조 [원고의 인도 및 교정]",
      "'저작권자'는 {{근로계약 시작일}}까지 완전 원고를 인도하며, 출판 편집 과정의 교열·검수에 성실히 협력한다.",
      "",
      "제3조 [출판 사용료(인세) 및 정산]",
      "1. 선인세(계약금): 금 {{계약금액}}원 ({{세무구분}} 원천징수 후 지급)",
      "2. 발행 인세율: 도서 정가의 {{인세율}}% × 실판매부수로 산정하여 매 분기 익월 정산 지급한다.",
      "",
      "제4조 [존속기간]",
      "본 계약은 {{근로계약 시작일}}부터 {{근로계약 종료일}}(미기재 시 초판 발행일로부터 5년)까지 유효하다.",
      "",
      "계약일: {{계약일}}",
      "[출판사] {{회사명}} ({{회사주소}}) 대표이사 {{대표자명}} {{회사 직인}}",
      "[저작권자] 성명: {{구성원 이름}} (연락처: {{구성원 연락처}}) {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-pub-outsourcing",
    title: "외주 편집·조판·일러스트 용역 계약서",
    categoryName: "출판·외주 계약서",
    mappedCategory: "OUTSOURCING",
    description: "교재 내지 조판, 표지 디자인, 삽화·교열 프리랜서 용역계약서",
    bodyText: [
      "발주자 {{회사명}}(이하 '갑')과 수급자 {{구성원 이름}}(이하 '을')은 도서 「{{도서명}}」 제작 용역에 관하여 다음과 같이 계약을 체결한다.",
      "",
      "제1조 [과업 범위 및 납품 기한]",
      "1. 과업 내용: 「{{도서명}}」 관련 {{직무}} 과업 일체 및 원본 작업 파일(InDesign/AI 등) 인도",
      "2. 과업 기간: {{근로계약 시작일}} ~ {{근로계약 종료일}}",
      "",
      "제2조 [용역 대금 및 세무 처리]",
      "1. 용역 대금 총액: 금 {{계약금액}}원",
      "2. 세무 구분: {{세무구분}} 기준 원천징수 공제 후 검수 완료일 익월 지정 계좌로 지급한다.",
      "",
      "제3조 [저작재산권의 귀속 및 제3자 권리 보증]",
      "본 용역 결과물(2차적저작물 작성권 포함)의 저작재산권 일체는 대금 완납과 동시에 '갑'에게 양도 귀속되며, '을'은 폰트·이미지 등 제3자 저작권을 침해하지 않음을 보증한다.",
      "",
      "계약일: {{계약일}}",
      "[갑] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[을] 성명(상호): {{구성원 이름}} (연락처: {{구성원 연락처}}) {{구성원 직인}}",
    ].join("\n"),
  },
  {
    id: "st-math-problem-authoring",
    title: "수학 문항 출제·검수 위촉 및 저작권 양도 계약서",
    categoryName: "출판·외주 계약서",
    mappedCategory: "OUTSOURCING",
    description: "창의·사고력 수학 문항 개발 및 진단평가 문항 출제 위촉 계약서",
    bodyText: [
      "{{회사명}}(이하 '연구소')과 출제위원 {{구성원 이름}}(이하 '위원')은 수학 문항 연구·출제 및 검수 위촉에 관하여 다음과 같이 계약한다.",
      "",
      "제1조 [위촉 대상 및 기한]",
      "• 대상 프로젝트/교재: 「{{도서명}}」",
      "• 위촉 기간: {{근로계약 시작일}} ~ {{근로계약 종료일}}",
      "",
      "제2조 [독창성 및 기출 표절 금지]",
      "'위원'이 출제하여 납품하는 모든 문항과 풀이는 타 출판사 교재 또는 국내외 경시대회 저작권 문항을 표절하지 않은 순수 창작·적법 변형 문항이어야 한다.",
      "",
      "제3조 [연구비(출제료) 및 저작재산권 양도]",
      "1. 위촉 대금: 금 {{계약금액}}원 ({{세무구분}} 기준 원천징수 후 지급)",
      "2. 납품 검수된 문항·해설·도형의 저작재산권 전부(온·오프라인 DB 수록 및 2차적저작물 작성권 포함)는 '연구소'에 영구 귀속된다.",
      "",
      "계약일: {{계약일}}",
      "[연구소] {{회사명}} 대표이사 {{대표자명}} {{회사 직인}}",
      "[위원] 성명: {{구성원 이름}} (연락처: {{구성원 연락처}}) {{구성원 직인}}",
    ].join("\n"),
  },
];

// 최초 서식 관리 기본 시드 서식 4종 (플렉스 스크린샷 6의 자동 연봉계약서/자동 근로계약서 + 출판사 필수 2종)
export const DEFAULT_SEEDED_CONTRACT_TEMPLATES: HqContractTemplateItem[] = [
  {
    id: "tpl-auto-salary",
    name: "자동 연봉계약서",
    description: "포괄임금 기준 구성원 연봉 자동 연동 서식",
    category_name: "자동계약서",
    mapped_category: "SALARY",
    tags: ["포괄임금", "연봉갱신"],
    body_text: STARTER_TEMPLATE_PRESETS[0].bodyText,
    is_archived: false,
    is_system_seed: true,
    updated_by: "시스템 기본",
    updated_at: "2026-01-01T09:00:00+09:00",
    created_at: "2026-01-01T09:00:00+09:00",
  },
  {
    id: "tpl-auto-labor",
    name: "자동 근로계약서",
    description: "구성원 근무유형·연봉·인사정보 자동 치환 표준 근로계약서",
    category_name: "자동계약서",
    mapped_category: "LABOR",
    tags: ["정규직", "표준근로"],
    body_text: STARTER_TEMPLATE_PRESETS[1].bodyText,
    is_archived: false,
    is_system_seed: true,
    updated_by: "시스템 기본",
    updated_at: "2026-01-01T09:00:00+09:00",
    created_at: "2026-01-01T09:00:00+09:00",
  },
  {
    id: "tpl-pub-royalty",
    name: "저자 출판권 설정 표준계약서",
    description: "단행본 및 교재 저자 인세·선인세 출판권 계약 서식",
    category_name: "출판·외주 계약서",
    mapped_category: "ROYALTY",
    tags: ["저자계약", "인세"],
    body_text: STARTER_TEMPLATE_PRESETS[9].bodyText,
    is_archived: false,
    is_system_seed: true,
    updated_by: "시스템 기본",
    updated_at: "2026-01-01T09:00:00+09:00",
    created_at: "2026-01-01T09:00:00+09:00",
  },
  {
    id: "tpl-pub-outsourcing",
    name: "외주 조판·디자인·출제 용역계약서",
    description: "3.3% / 8.8% 프리랜서 외주 용역 및 저작권 양도 표준 서식",
    category_name: "출판·외주 계약서",
    mapped_category: "OUTSOURCING",
    tags: ["외주용역", "3.3%"],
    body_text: STARTER_TEMPLATE_PRESETS[10].bodyText,
    is_archived: false,
    is_system_seed: true,
    updated_by: "시스템 기본",
    updated_at: "2026-01-01T09:00:00+09:00",
    created_at: "2026-01-01T09:00:00+09:00",
  },
];

// 플레이스홀더 자동 치환 엔진
export function resolveContractTemplatePlaceholders(params: {
  templateBody: string;
  companySettings: HqCompanySettings;
  member?: HqMember | null;
  workRule?: HqWorkRuleItem | null;
  counterpartyName?: string;
  counterpartyRole?: string;
  counterpartyPhone?: string;
  department?: string;
  bookTitle?: string;
  startDate?: string;
  endDate?: string;
  contractAmount?: number;
  royaltyRate?: number | null;
  taxLabel?: string;
  customValues?: Record<string, string>;
}): string {
  const {
    templateBody,
    companySettings,
    member,
    workRule,
    counterpartyName,
    counterpartyRole,
    counterpartyPhone,
    department,
    bookTitle,
    startDate,
    endDate,
    contractAmount,
    royaltyRate,
    taxLabel,
    customValues,
  } = params;

  const todayYmd = new Date().toISOString().slice(0, 10);
  const rule = workRule || DEFAULT_WORK_RULES[3] || DEFAULT_WORK_RULES[0];

  const wc = member?.profile_extra?.wage_contract;
  const lc = member?.profile_extra?.labor_contract;

  const annualSalary =
    contractAmount && contractAmount > 0
      ? contractAmount
      : wc?.annual_salary ||
        (wc?.amount_unit === "월급" && wc?.contract_amount
          ? wc.contract_amount * 12
          : wc?.monthly_base
            ? wc.monthly_base * 12
            : 42000000);

  const monthlyGross = Math.round(annualSalary / 12);
  const mealAllowance = wc?.meal_allowance ?? 200000;
  const taxableMonthly = Math.max(0, monthlyGross - mealAllowance);

  const savedFixedOt = wc?.fixed_overtime;
  const hasSavedFixedOt = Boolean(
    savedFixedOt?.enabled && savedFixedOt.total_contract_hours > 0
  );
  const monthlyBase =
    hasSavedFixedOt && wc?.monthly_base
      ? wc.monthly_base
      : Math.round((taxableMonthly * 0.82) / 100) * 100;
  const fixedOvertimePay =
    hasSavedFixedOt && wc?.fixed_overtime_allowance !== undefined
      ? wc.fixed_overtime_allowance
      : Math.max(0, taxableMonthly - monthlyBase);

  const fixedOtHoursText = hasSavedFixedOt
    ? `${savedFixedOt!.is_weekly_input ? "주" : "월"} ${savedFixedOt!.total_contract_hours}시간 (가산 ${savedFixedOt!.total_weighted_hours}시간)`
    : "월 22시간 (주 약 5시간)";

  const breakMins = calcBreakMinutes(rule);
  const fmtMoney = (n: number) => Math.max(0, Math.round(n)).toLocaleString("ko-KR");

  const startStr = startDate || lc?.start_date || member?.hire_date || todayYmd;
  const endStr =
    endDate ||
    lc?.end_date ||
    wc?.end_date ||
    `${new Date(startStr).getFullYear() || new Date().getFullYear()}-12-31`;

  const probationStart = lc?.probation_start_date || startStr;
  // 수습 종료일 (시작일 + 3개월 - 1일)
  let probationEnd = lc?.probation_end_date || "";
  if (!probationEnd && startStr) {
    const dt = new Date(`${startStr}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) {
      dt.setMonth(dt.getMonth() + 3);
      dt.setDate(dt.getDate() - 1);
      probationEnd = dt.toISOString().slice(0, 10);
    }
  }
  const probationPayRateText =
    lc?.salary_pay_rate !== undefined && lc?.salary_pay_rate !== null
      ? `${lc.salary_pay_rate}%`
      : "100%";

  const dict: Record<string, string> = {
    "{{회사명}}": companySettings?.company_name || "(주)천종현수학연구소",
    "{{회사주소}}":
      companySettings?.address || "서울특별시 송파구 백제고분로34길 11-15",
    "{{사업자 등록번호}}": companySettings?.business_reg_no || "215-87-00000",
    "{{대표자명}}": companySettings?.ceo_names?.[0] || "천종현",
    "{{회사 직인}}": "(직인 날인)",
    "{{회사 직인(서명란 포함)}}": "(대표이사 직인 날인)",
    "{{구성원 직인}}": "(전자서명)",
    "{{구성원 직인(서명란 포함)}}": "(서명 또는 인)",
    "{{계약일}}": todayYmd,

    "{{구성원 이름}}": counterpartyName || member?.name || "홍길동",
    "{{구성원 주소}}": member?.address || "(주소지 정보)",
    "{{구성원 연락처}}": counterpartyPhone || member?.phone || "010-0000-0000",
    "{{구성원 법정 생년월일}}": member?.birth_date || "1990-01-01",

    "{{사번}}":
      member?.employee_no && !member.employee_no.startsWith("HQ-TEMP")
        ? member.employee_no
        : "-",
    "{{주조직}}": department || member?.department || "출판편집본부",
    "{{직책}}": counterpartyRole || member?.job_title || "연구원",
    "{{직무}}": member?.job_description || counterpartyRole || "교재 기획·편집",
    "{{직위}}": member?.job_title || counterpartyRole || "사원",

    "{{임금계약 시작일}}": wc?.start_date || wc?.effective_date || startStr,
    "{{임금계약 종료일}}": wc?.end_date || endStr,
    "{{급여 지급기준}}": wc?.wage_type || "연봉제 (포괄임금)",
    "{{계약금액}}": fmtMoney(annualSalary),
    "{{월 지급액}}": fmtMoney(monthlyGross),
    "{{기본급}}": fmtMoney(monthlyBase),
    "{{급여일}}": wc?.pay_day || "매월 25일",
    "{{포괄임금 계약기준}}": hasSavedFixedOt
      ? "월 소정근로 209시간 + 포괄 약정 초과근로시간 산정"
      : "월 소정근로 209시간 + 고정연장근로 포괄 산정",
    "{{포괄임금 고정초과근무 계약시간}}": fixedOtHoursText,
    "{{포괄임금 고정초과근무 수당}}": fmtMoney(fixedOvertimePay),
    "{{식대 비과세}}": fmtMoney(mealAllowance),

    "{{계약유형}}": lc?.employment_type || member?.employment_type || "정규직",
    "{{근로계약 시작일}}": startStr,
    "{{근로계약 종료일}}": endDate || lc?.end_date || "기간의 정함이 없음",
    "{{수습기간 시작일}}": probationStart,
    "{{수습기간 종료일}}": probationEnd || "-",
    "{{수습기간 급여지급률}}": probationPayRateText,

    "{{근로일}}": (rule?.work_days || ["월", "화", "수", "목", "금"]).join(", "),
    "{{주휴일}}": (rule?.paid_rest_days || ["일"]).join(", ") + "요일",
    "{{근무제}}": rule?.pattern_type || "고정 근무 유형",
    "{{출근시간}}": formatHmToKoreanAmPm(rule?.start_time || "09:00"),
    "{{휴게시간}}":
      rule?.break_start_1 && rule?.break_end_1
        ? `${rule.break_start_1} ~ ${rule.break_end_1} (${breakMins}분)`
        : "13:00 ~ 14:00 (60분)",
    "{{소정근로시간}}": `${rule?.daily_work_hours || 8}시간`,

    "{{도서명}}": bookTitle || "신간 수학교재",
    "{{인세율}}": String(royaltyRate ?? 10),
    "{{세무구분}}": taxLabel || "사업소득 원천징수 (3.3%)",
  };

  if (customValues) {
    Object.entries(customValues).forEach(([token, val]) => {
      dict[token] = val;
    });
  }

  let out = templateBody;
  Object.entries(dict).forEach(([token, val]) => {
    out = out.split(token).join(val);
  });
  return out;
}

// 외부 저자·프리랜서 원천세 및 실수령액 즉시 시뮬레이터
export function calcContractTaxBreakdown(
  grossAmount: number,
  taxType: HqContractTaxType
): {
  gross: number;
  withholdingTax: number;
  vatAdd: number;
  netPayout: number;
  formulaNote: string;
} {
  const gross = Math.max(0, Math.round(Number(grossAmount) || 0));
  if (gross === 0) {
    return {
      gross: 0,
      withholdingTax: 0,
      vatAdd: 0,
      netPayout: 0,
      formulaNote: "금액 미지정",
    };
  }

  if (taxType === "BIZ_33") {
    // 소득세 3% + 지방소득세 0.3% (원 단위 절사)
    const incomeTax = Math.floor((gross * 0.03) / 10) * 10;
    const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
    const withholdingTax = incomeTax + localTax;
    return {
      gross,
      withholdingTax,
      vatAdd: 0,
      netPayout: gross - withholdingTax,
      formulaNote: "프리랜서 사업소득 3.3% (소득세 3% + 지방세 0.3%) 공제",
    };
  }

  if (taxType === "OTHER_88") {
    // 기타소득 필요경비 60% 인정 -> 과세표준 40% × 22%(지방세 포함) = 총액의 8.8%
    const incomeTax = Math.floor((gross * 0.4 * 0.2) / 10) * 10;
    const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
    const withholdingTax = incomeTax + localTax;
    return {
      gross,
      withholdingTax,
      vatAdd: 0,
      netPayout: gross - withholdingTax,
      formulaNote: "기타소득 8.8% (필요경비 60% 공제 후 22% 원천징수)",
    };
  }

  if (taxType === "INVOICE") {
    const vatAdd = Math.round(gross * 0.1);
    return {
      gross,
      withholdingTax: 0,
      vatAdd,
      netPayout: gross + vatAdd,
      formulaNote: "세금계산서 (부가가치세 10% 별도 가산 · 면세 계산서는 부가세 없음)",
    };
  }

  return {
    gross,
    withholdingTax: 0,
    vatAdd: 0,
    netPayout: gross,
    formulaNote:
      taxType === "FOUR_INSURANCE"
        ? "매월 급여 정산 시 4대보험 및 근로소득세 간이세액표 기준 원천공제"
        : "별도 원천징수 없음",
  };
}
