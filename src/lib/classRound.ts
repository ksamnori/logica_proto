// 반별 홀짝(week_type) 서버 상태 계산 + 회차(수업일) 경과 시 미완료 과제 이관.
//
// 핵심 규칙(사용자 확정):
// - even/odd(주간테스트 ↔ 과제오답유사)는 "주" 단위가 아니라 실제 수업 회차 기준으로, 회차가 하나
//   지날 때마다 매번 번갈아 전환된다(기본 주2회든, 화목토 주3회든 동일 — 화 1회차=주간테스트,
//   목 2회차=과제오답유사, 다음주 화 3회차=주간테스트... 처럼 한 회차씩 교대).
// - 실제 수업 횟수에는 정규 class_schedule 요일뿐 아니라, 그 반에 잡힌 보강(class_extra_session)도 포함된다.
// - "회차가 지나서 과제가 미완성으로 넘어가는" 것은 홀짝 전환과 무관하게 매 개별 수업일(회차)마다 일어난다.
//
// 필요 테이블/컬럼: class.week_type, class.week_type_updated_date(마지막으로 처리된 회차 날짜),
// class_holiday, class_extra_session.
// 💡 class.session_parity는 예전에 "2회 쌍" 단위로 전환하던 시절의 레거시 컬럼이다 — 이제 매 회차마다
// 무조건 전환하므로 더 이상 의미가 없다. 스키마 변경 없이 그대로 두되 항상 false로만 기록한다.

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

// 💡 [버그 수정] 'T00:00:00+09:00'로 파싱한 뒤 getUTCDay()를 읽으면 그 순간의 UTC 날짜(=KST보다
// 9시간 이른, 즉 하루 전날)의 요일이 나온다 — 그래서 화요일을 월요일로, 목요일을 수요일로 착각해
// scheduleDays 매칭이 통째로 하루 밀렸다(회차/휴일 판정이 실제 요일보다 하루 어긋남). 오프셋 변환 없이
// 그 날짜 문자열 자체를 UTC 자정으로 취급해야(getISOWeekKST와 동일한 방식) 정확한 요일이 나온다.
const dayLabelOf = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_LABELS[d.getUTCDay()];
};

export type ClassRoundInput = {
  class_id: string;
  class_name: string;
  week_type: string | null;
  week_type_updated_date: string | null; // 마지막으로 처리된 회차(수업일) 날짜
  session_parity: boolean | null; // 💡 레거시(더 이상 사용 안 함) — 항상 false로만 기록됨
  scheduleDays: string[]; // class_schedule.day_of_week 값들 ('월'..'일')
  // 💡 미래 날짜 예약 강제 배정. anchor(week_type_updated_date)는 건드리지 않고 별도로 들고 있다가,
  // 아래 순회가 실제로 이 날짜에 도달했을 때만(정상적인 회차 처리 도중) odd/even을 이 값으로
  // 덮어쓴다 — 그래야 예약 시점과 적용 시점 사이의 실제 회차들이 스킵되지 않는다.
  forced_week_type?: string | null;
  forced_week_type_date?: string | null;
};

export type ClassRoundResult = { weekType: string; transitioned: boolean };

// 학생/관리자 화면 로드 시 호출. 마지막으로 처리된 회차 다음날부터 오늘까지 실제 수업일
// (정규 요일 - 휴일 + 보강일)을 순회하며, 매 회차마다 미완료 과제를 이관하고 odd/even을
// 한 회차씩 번갈아 뒤집는다(화 1회차=주간테스트, 목 2회차=과제오답유사, 다음주 화 3회차=
// 주간테스트...). 여러 번 호출해도 안전(idempotent).
export async function resolveClassWeekType(supabase: any, input: ClassRoundInput): Promise<ClassRoundResult> {
  const today = getKSTDateString();
  let weekType = input.week_type === 'even' ? 'even' : 'odd';
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
  let forcedApplied = false;

  while (cursor < today) {
    cursor = addDaysKST(cursor, 1);
    const isRegularSession = input.scheduleDays.includes(dayLabelOf(cursor)) && !holidaySet.has(cursor);
    const isExtraSession = extraSet.has(cursor);
    if (!isRegularSession && !isExtraSession) continue; // 휴일/보강 없는 날은 회차가 아니므로 건너뜀

    // 회차가 하나 지났다 — 미완료 과제를 이관하고, 그 회차마다 무조건 odd/even을 뒤집는다.
    await migrateIncompleteForClassRound(supabase, input.class_id, cursor);
    if (input.forced_week_type_date && cursor === input.forced_week_type_date && input.forced_week_type) {
      // 💡 이 회차가 예약해둔 강제 배정 날짜다 — 토글 대신 예약된 타입으로 못박고, 예약은 소진됐으니
      // 이후 회차부터는 다시 정상적으로(이 타입에서 시작해) 한 회차씩 번갈아 진행된다.
      weekType = input.forced_week_type === 'even' ? 'even' : 'odd';
      forcedApplied = true;
    } else {
      weekType = weekType === 'odd' ? 'even' : 'odd';
    }
    lastDate = cursor;
    changed = true;
  }

  if (changed) {
    const update: Record<string, any> = { week_type: weekType, week_type_updated_date: lastDate, session_parity: false };
    if (forcedApplied) { update.forced_week_type = null; update.forced_week_type_date = null; }
    await supabase.from('class').update(update).eq('class_id', input.class_id);
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

export async function setClassExtraSession(supabase: any, classId: string, sessionDate: string, reason: string, startTime?: string | null, endTime?: string | null, replacesHolidayId?: string | null) {
  return supabase.from('class_extra_session').upsert(
    { class_id: classId, session_date: sessionDate, reason, start_time: startTime || null, end_time: endTime || null, replaces_holiday_id: replacesHolidayId || null },
    { onConflict: 'class_id,session_date' }
  );
}

export async function removeClassExtraSession(supabase: any, id: string) {
  return supabase.from('class_extra_session').delete().eq('id', id);
}
