// 반별 홀짝(week_type) 서버 상태 계산 + 회차(수업일) 경과 시 미완료 과제 이관.
//
// 핵심 규칙(사용자 확정):
// - even/odd는 "주" 단위가 아니라 "실제 수업 횟수 2회마다 1번" 전환된다(기본 주2회든, 화목토 주3회든
//   동일 — 달력 주 경계와 무관하게 세션을 연속으로 세어 2개씩 묶는다).
// - 실제 수업 횟수에는 정규 class_schedule 요일뿐 아니라, 그 반에 잡힌 보강(class_extra_session)도 포함된다.
// - "회차가 지나서 과제가 미완성으로 넘어가는" 것은 홀짝 전환과 무관하게 매 개별 수업일(회차)마다 일어난다.
//
// 필요 테이블/컬럼: class.week_type, class.week_type_updated_date(마지막으로 처리된 회차 날짜),
// class.session_parity(현재 2회 쌍 중 1회를 지났는지), class_holiday, class_extra_session.

export const getKSTDateString = (base: Date = new Date()) =>
  new Date(base.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

// 전원 공통 ISO-8601 달력 주차(1~53). 주간테스트에 강사가 입력한 test_week와
// 매칭시키는 데 쓴다 — 반마다 다른 odd/even 회차 전환(session_parity)과는 무관한 값.
export const getISOWeekKST = (base: Date = new Date()): number => {
  const dateStr = getKSTDateString(base);
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export const addDaysKST = (dateStr: string, days: number) => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setUTCDate(d.getUTCDate() + days);
  return getKSTDateString(d);
};

const dayLabelOf = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return DAY_LABELS[d.getUTCDay()];
};

export type ClassRoundInput = {
  class_id: string;
  class_name: string;
  week_type: string | null;
  week_type_updated_date: string | null; // 마지막으로 처리된 회차(수업일) 날짜
  session_parity: boolean | null; // true = 현재 2회 쌍 중 1회를 이미 지남(다음 회차에 전환됨)
  scheduleDays: string[]; // class_schedule.day_of_week 값들 ('월'..'일')
};

export type ClassRoundResult = { weekType: string; transitioned: boolean };

// 학생/관리자 화면 로드 시 호출. 마지막으로 처리된 회차 다음날부터 오늘까지 실제 수업일
// (정규 요일 - 휴일 + 보강일)을 순회하며, 매 회차마다 미완료 과제를 이관하고, 회차 2개마다
// 1번씩 odd/even을 뒤집는다. 여러 번 호출해도 안전(idempotent).
export async function resolveClassWeekType(supabase: any, input: ClassRoundInput): Promise<ClassRoundResult> {
  const today = getKSTDateString();
  let weekType = input.week_type === 'even' ? 'even' : 'odd';
  let parity = !!input.session_parity;
  let lastDate = input.week_type_updated_date;

  if (!lastDate) {
    await supabase.from('class').update({ week_type: weekType, week_type_updated_date: today, session_parity: false }).eq('class_id', input.class_id);
    return { weekType, transitioned: false };
  }
  if (lastDate >= today) {
    return { weekType, transitioned: false };
  }

  const [{ data: holidayRows }, { data: extraRows }] = await Promise.all([
    supabase.from('class_holiday').select('holiday_date').gt('holiday_date', lastDate).lte('holiday_date', today).or(`class_id.eq.${input.class_id},class_id.is.null`),
    supabase.from('class_extra_session').select('session_date').eq('class_id', input.class_id).gt('session_date', lastDate).lte('session_date', today),
  ]);
  const holidaySet = new Set((holidayRows || []).map((h: any) => h.holiday_date));
  const extraSet = new Set((extraRows || []).map((e: any) => e.session_date));

  let cursor = lastDate;
  let changed = false;

  while (cursor < today) {
    cursor = addDaysKST(cursor, 1);
    const isRegularSession = input.scheduleDays.includes(dayLabelOf(cursor)) && !holidaySet.has(cursor);
    const isExtraSession = extraSet.has(cursor);
    if (!isRegularSession && !isExtraSession) continue; // 휴일/보강 없는 날은 회차가 아니므로 건너뜀

    // 회차가 하나 지났다 — 홀짝 전환 여부와 무관하게 그 회차의 미완료 과제를 항상 이관한다.
    await migrateIncompleteForClassRound(supabase, input.class_id, cursor);

    if (!parity) {
      parity = true; // 2회 쌍의 첫 번째 회차 — 아직 전환 안 함
    } else {
      parity = false; // 2회 쌍의 두 번째 회차 — 전환
      weekType = weekType === 'odd' ? 'even' : 'odd';
    }
    lastDate = cursor;
    changed = true;
  }

  if (changed) {
    await supabase.from('class').update({ week_type: weekType, week_type_updated_date: lastDate, session_parity: parity }).eq('class_id', input.class_id);
  }

  return { weekType, transitioned: changed };
}

// 특정 회차(수업일) 기준으로, 그 반의 아직 제출/채점되지 않은 과제의 due_date를 그 날짜로
// 당겨 닫는다 — 이러면 기존 due_date 기반 "미완성 과제" 판정(student/portal/page.tsx)이
// 다음 로드 때 바로 그 과제들을 미완성으로 분류한다. 새 상태 컬럼은 필요 없다.
export async function migrateIncompleteForClassRound(supabase: any, classId: string, sessionDate: string) {
  const { data: hwRows } = await supabase
    .from('homework_assignment')
    .select('homework_id, due_date, student_homework_result(status)')
    .eq('class_id', classId)
    .gt('due_date', sessionDate);

  const targetIds = (hwRows || [])
    .filter((h: any) => {
      const results = Array.isArray(h.student_homework_result) ? h.student_homework_result : [h.student_homework_result].filter(Boolean);
      return results.some((r: any) => r && r.status !== '제출완료' && r.status !== '채점완료');
    })
    .map((h: any) => h.homework_id);

  if (targetIds.length > 0) {
    await supabase.from('homework_assignment').update({ due_date: sessionDate }).in('homework_id', targetIds);
  }
}

export async function setClassHoliday(supabase: any, classId: string | null, holidayDate: string, reason: string) {
  return supabase.from('class_holiday').upsert({ class_id: classId, holiday_date: holidayDate, reason }, { onConflict: 'class_id,holiday_date' });
}

export async function removeClassHoliday(supabase: any, id: string) {
  return supabase.from('class_holiday').delete().eq('id', id);
}

export async function setClassExtraSession(supabase: any, classId: string, sessionDate: string, reason: string) {
  return supabase.from('class_extra_session').upsert({ class_id: classId, session_date: sessionDate, reason }, { onConflict: 'class_id,session_date' });
}

export async function removeClassExtraSession(supabase: any, id: string) {
  return supabase.from('class_extra_session').delete().eq('id', id);
}

