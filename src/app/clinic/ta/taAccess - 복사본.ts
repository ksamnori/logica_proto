// src/app/clinic/ta/taAccess.ts
//
// 조교(TA) 화면들(패드/채점)이 공유하는 유틸. 별도 로그인 없이 강사 로그인 시
// 저장된 이름(logica_instructor_name)을 그대로 조교 이름으로 재사용한다.
export const TA_NAME_STORAGE_KEY = 'logica_ta_name';

// 💡 강사 로그인(사이드바 "조교 전용 페이지로 이동" 경유)을 거쳐 들어온 경우엔 이미
// logica_instructor_name에 실명이 있으므로, 조교 이름을 따로 물어볼 필요가 없다.
export const getInstructorName = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('logica_instructor_name') || '';
};

// 💡 조교는 강사 로그인을 거치지 않아 logica_tenant_id가 없는 게 정상이다.
// 그 상태로 두면 채점 페이지의 지점 필터가 아예 안 걸려 전체 지점이 노출되므로,
// 이름을 입력한 시점에 이 지점의 tenant_id를 함께 심어준다.
export const seedTaTenantId = () => {
  const tenantId = process.env.NEXT_PUBLIC_TA_TENANT_ID || '';
  if (tenantId && !localStorage.getItem('logica_tenant_id')) {
    localStorage.setItem('logica_tenant_id', tenantId);
  }
};
